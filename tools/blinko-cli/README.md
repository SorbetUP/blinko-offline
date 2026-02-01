# Blinko CLI

CLI client that talks to the same backend as the GUI (auth + tRPC).

## Run

```bash
cd tools/blinko-cli
bun install
bun run start -- help
```

## Examples

```bash
bun run start -- login --base http://127.0.0.1:1111 --username admin --password secret
bun run start -- notes:list
bun run start -- notes:detail 123
bun run start -- notes:create --content "Hello"

# Local DB inspection (offline)
bun run start -- local:notes:list
bun run start -- local:notes:detail -1700000000000
```

Config is stored in `~/.blinko-cli.json`.
