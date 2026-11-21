# Production migrations — blocked pending reconciliation

This directory is intentionally free of top-level `.sql` files. `wrangler.production.jsonc` points here rather than to the incompatible development migration chain.

The live production D1 has an independent schema and migration history. The media changes in `archive/0009_media_ingestion.sql` were reportedly applied as equivalent SQL outside Wrangler's migration ledger; a read-only check on 2026-11-21 confirmed the columns and tables exist but that `d1_migrations` does not record this file. **Do not replay it** and do not run production `d1 migrations apply` based on this archive.

Before introducing production migrations: make and verify a backup, inventory and version the live schema and ledger, establish a reproducible baseline, review each migration and rollback plan, test against an isolated D1, then obtain explicit approval for any production writes. Update the config guard and documentation only when that process is ready. The archive is evidence, not an executable migration chain; it cannot recreate production.
