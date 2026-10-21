using System.Text.RegularExpressions;
using Microsoft.Data.SqlClient;

namespace SelfStorage.Api.Infrastructure;

public sealed class DevelopmentDatabaseBootstrapper(
    IConfiguration configuration,
    IWebHostEnvironment environment,
    ILogger<DevelopmentDatabaseBootstrapper> logger)
{
    private static readonly string[] MigrationFiles =
    [
        "02_billing_reservation_links.sql",
        "03_payment_concurrency.sql",
        "04_support_checklists.sql",
        "05_google_login.sql",
        "06_rental_policy_rules.sql",
        "07_monthly_rent_billing.sql",
        "08_check_in_appointments.sql",
        "09_cancellation_and_promotions.sql",
        "10_momo_checkout_links.sql",
        "11_unit_type_pricing.sql",
        "12_visit_registrations.sql",
        "13_email_outbox.sql",
        "14_business_timezone_defaults.sql",
    ];

    public async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        if (!environment.IsDevelopment())
            return;

        var connectionString = configuration.GetConnectionString("SelfStorageDB")
            ?? throw new InvalidOperationException("ConnectionStrings:SelfStorageDB is required.");
        var targetBuilder = new SqlConnectionStringBuilder(connectionString);
        if (!string.Equals(targetBuilder.InitialCatalog, "SelfStorageDB", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                "Development schema bootstrap currently requires Database=SelfStorageDB in the connection string.");

        var scriptDirectory = Path.Combine(AppContext.BaseDirectory, "Database");
        var schemaPath = Path.Combine(scriptDirectory, "01_schema.sql");
        if (!File.Exists(schemaPath))
            throw new FileNotFoundException("The development database schema was not copied to the application output.", schemaPath);

        var masterBuilder = new SqlConnectionStringBuilder(connectionString)
        {
            InitialCatalog = "master",
        };
        await using (var master = new SqlConnection(masterBuilder.ConnectionString))
        {
            await master.OpenAsync(cancellationToken);
            await using var existsCommand = new SqlCommand("SELECT DB_ID(@databaseName);", master);
            existsCommand.Parameters.AddWithValue("@databaseName", targetBuilder.InitialCatalog);
            var databaseId = await existsCommand.ExecuteScalarAsync(cancellationToken);
            if (databaseId is null or DBNull)
            {
                logger.LogInformation("Creating local development database {DatabaseName}.", targetBuilder.InitialCatalog);
                await ExecuteScriptAsync(master, schemaPath, cancellationToken);
            }
        }

        await using var database = new SqlConnection(targetBuilder.ConnectionString);
        await database.OpenAsync(cancellationToken);
        foreach (var fileName in MigrationFiles)
        {
            var scriptPath = Path.Combine(scriptDirectory, fileName);
            if (!File.Exists(scriptPath))
                throw new FileNotFoundException($"Required development database migration {fileName} is missing.", scriptPath);

            await ExecuteScriptAsync(database, scriptPath, cancellationToken);
            logger.LogInformation("Applied development database migration {Migration}.", fileName);
        }
    }

    private static async Task ExecuteScriptAsync(
        SqlConnection connection, string scriptPath, CancellationToken cancellationToken)
    {
        var script = await File.ReadAllTextAsync(scriptPath, cancellationToken);
        var batches = Regex.Split(script, @"^\s*GO\s*(?:--.*)?$", RegexOptions.Multiline | RegexOptions.IgnoreCase);
        var batchNumber = 0;
        foreach (var batch in batches)
        {
            if (string.IsNullOrWhiteSpace(batch))
                continue;

            batchNumber++;
            await using var command = new SqlCommand(batch, connection)
            {
                CommandTimeout = 120,
            };
            try
            {
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
            catch (SqlException ex)
            {
                throw new InvalidOperationException(
                    $"Database script '{Path.GetFileName(scriptPath)}' failed at batch {batchNumber}.", ex);
            }
        }
    }
}
