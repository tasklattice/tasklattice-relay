"""Create the dedicated database using the provider image's asyncpg dependency."""
import asyncio
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlparse

import asyncpg


async def bootstrap():
    config = json.loads(Path('/etc/hindsight/config.json').read_text())
    target = urlparse(config['common']['HINDSIGHT_API_DATABASE_URL'])
    user = unquote(target.username or '')
    password = unquote(target.password or '')
    database = unquote(target.path.lstrip('/'))
    schema = config['migration']['schema']
    for identifier in (user, database, schema):
        if not re.fullmatch(r'[a-z_][a-z0-9_]{0,62}', identifier):
            raise ValueError('Hindsight database identifiers must be lowercase PostgreSQL identifiers')
    admin_url = Path('/etc/postgresql/admin-url').read_text().strip()
    for attempt in range(60):
        try:
            admin = await asyncpg.connect(admin_url, timeout=5)
            break
        except (OSError, asyncpg.PostgresConnectionError):
            if attempt == 59:
                raise RuntimeError('PostgreSQL did not become available for Hindsight bootstrap') from None
            await asyncio.sleep(2)
    try:
        # Serialize bootstrap across overlapping configuration revisions.
        await admin.execute("SELECT pg_advisory_lock(hashtext('tali-hindsight-bootstrap'))")
        if not await admin.fetchval('SELECT 1 FROM pg_roles WHERE rolname=$1', user):
            await admin.execute(f'CREATE ROLE "{user}" LOGIN')
        statement = await admin.fetchval('SELECT format(\'ALTER ROLE %I PASSWORD %L\', $1::text, $2::text)', user, password)
        await admin.execute(statement)
        if not await admin.fetchval('SELECT 1 FROM pg_database WHERE datname=$1', database):
            await admin.execute(f'CREATE DATABASE "{database}" OWNER "{user}"')
        await admin.execute(f'ALTER DATABASE "{database}" OWNER TO "{user}"')
        connection = await asyncpg.connect(admin_url, database=database)
        try:
            await connection.execute('CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public')
            await connection.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public')
            await connection.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}" AUTHORIZATION "{user}"')
            await connection.execute(f'ALTER SCHEMA "{schema}" OWNER TO "{user}"')
            await connection.execute(f'GRANT USAGE ON SCHEMA public TO "{user}"')
        finally:
            await connection.close()
    finally:
        await admin.close()
    print('Hindsight database bootstrap completed')


if __name__ == '__main__':
    asyncio.run(bootstrap())
