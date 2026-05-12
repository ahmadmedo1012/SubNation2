# Neon MCP Server Setup

This project is configured to use the Neon MCP server for direct database access through the Model Context Protocol.

## Configuration

### 1. Get Your Neon API Key

1. Go to https://console.neon.tech/settings/api-keys
2. Click "Create API Key" or use an existing one
3. Copy the API key

### 2. Add API Key to Environment

Add your Neon API key to the `.env` file:

```bash
NEON_API_KEY=your_actual_api_key_here
```

### 3. MCP Server Configuration

The MCP server is configured in `.claude/mcp.json`:

```json
{
  "mcpServers": {
    "neon": {
      "type": "http",
      "url": "https://mcp.neon.tech/mcp",
      "headers": {
        "Authorization": "Bearer ${NEON_API_KEY}"
      }
    }
  }
}
```

## Usage

Once configured with a valid NEON_API_KEY, the Neon MCP server provides:

- **Direct database access**: Query your Neon PostgreSQL database
- **Schema inspection**: View database tables, columns, and relationships
- **Safe operations**: Read-only access by default
- **Project context**: Automatic connection to your project's database

## Safety

- The MCP server uses read-only operations by default
- No schema modifications are performed
- No destructive operations are allowed
- Connection is authenticated via API key

## Validation

To validate the connection:

1. Ensure NEON_API_KEY is set in `.env`
2. Restart your IDE/terminal to load the new environment variable
3. The MCP server will automatically connect to your Neon database
4. You can query tables like `users`, `orders`, `products`, etc.

## Troubleshooting

If the MCP connection fails:

1. Verify NEON_API_KEY is correctly set in `.env`
2. Check that the API key is valid in Neon console
3. Ensure your IDE/terminal has loaded the environment variables
4. Check that your Neon project is active

## Database Connection

The project uses Neon PostgreSQL:
- Host: ep-noisy-dream-aqltup8y-pooler.c-8.us-east-1.aws.neon.tech
- Database: neondb
- User: neondb_owner

This is the same database used by the application backend.
