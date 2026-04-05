# alnvdl/littletable

> This application is an experiment in vibe coding, it's not representative of
> my usual work style. See [How this was built](#how-this-was-built).

Littletable is a simple menstrual cycle tracker. It provides a calendar view
with cycle annotations and a chart showing cycle lengths over time. It is meant
to be self-hosted and used by one or more (anonymous) users.

It can be used as a PWA, and should work in read-only offline mode. It is
deployed as a single-binary Go application with all static assets embedded.
Data is stored in a JSON file that is periodically auto-saved.

## Running
To run Littletable locally, install Go 1.25+ and run `make dev`.

To access the web interface, go to http://localhost:8080/?token=alice.

To export data, triple-click on the logo.

## Environment variables
The following environment variables can be used to configure Littletable:

- `TOKENS`: A list of tokens used for authentication and the associated cycle
  tracking strategy (comma-separated). Each token will be an anonymous user.
  This variable is required. Supported strategies are `pregnancy`,
  `avoid-pregnancy` and `avoid-pregnancy-zealous`.
  Example: `abc123:pregnancy,def456:avoid-pregnancy`.
- `DB_PATH`: The path to the database file.
  The default is `db.json`.
- `PORT`: The port on which the server will run.
  The default is `8080`.
- `PERSIST_INTERVAL`: The interval for persisting data to disk.
  The default is `5m`.

## API

### `GET /cycles?token=...`
Returns the cycle tracking strategy and all cycle start dates for user
identified by the token.

**Request body**: none

**Authenticated**: yes (`?token=...`)

**Responses**:
- `200`:
   ```json
   {
      "strategy": "pregnancy",
      "dates": ["2026-01-01", "2026-01-28", "2026-02-25"]
   }
   ```
- `403`: `Forbidden`

### `POST /start?token=...`
Adds a cycle start date for user identified by the token. If the date already
exists, it is a no-op.

**Request body**:
```json
"2026-03-08"
```

**Authenticated**: yes (`?token=...`)

**Responses**:
- `204`: (empty body)
- `400`: `Bad Request: invalid JSON` or
  `Bad Request: date must be in YYYY-MM-DD format`
- `403`: `Forbidden`

### `DELETE /start?token=...`
Removes a cycle start date for user identified by the token.

**Request body**:
```json
"2026-03-08"
```

**Authenticated**: yes (`?token=...`)

**Responses**:
- `204`: (empty body)
- `400`: `Bad Request: invalid JSON` or
  `Bad Request: date must be in YYYY-MM-DD format`
- `403`: `Forbidden`
- `404`: `Not Found`

## Deploying in Azure App Service
It is quite easy to deploy and run this application on the Azure App Service
free tier.

1. Deploy the app in Azure following the
   [quick start guide](https://learn.microsoft.com/en-us/azure/app-service/quickstart-custom-container?tabs=dotnet&pivots=container-linux-azure-portal).
   When selecting the container image, input `ghcr.io` as the registry and
   `alnvdl/littletable:main` as the image, leaving the startup command blank.

2. Make sure to set the following environment variables in the deployment:
   | Environment variable                  | Value
   | -                                     | -
   | `DB_PATH`                             | `/home/db.json`
   | `TOKENS`                              | The list of anonymous users and their cycle tracking strategies
   | `PORT`                                | `80`
   | `WEBSITES_ENABLE_APP_SERVICE_STORAGE` | `true`

3. While not required, you may want to enable log persistence as well by
   following this
   [guide](https://learn.microsoft.com/en-us/azure/app-service/troubleshoot-diagnostic-logs#enable-application-logging-linuxcontainer).

4. You may need to restart the application after the initial setup to make
   sure all settings are picked up.

5. To deploy new versions of the image, just restart the application (assuming
   the deployment is using the `main` tag mentioned in step 1).

## How this was built
This app was built with multiple LLMs in GitHub Copilot, starting with a pure
offline frontend at first with mock data, and then adding a backend.

The code is not very polished, but shouldn't be terrible either. This is an
experiment at working with LLMs at a much higher level than I'm used to: asking
for vague things like "an elegant UI with a calendar and bar charts" and
dictating the backend design just at a very superficial level. At times, I
pointed to other examples of applications that I coded myself.

This application intentionally avoids using external dependencies to make it
easier to maintain many years from now.

## Icons
All icons are from the
[Material Symbols & Icons project](https://fonts.google.com/icons).
