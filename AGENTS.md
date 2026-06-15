# Agent Instructions

1. Never run native builds without explicit user approval. The user will run native builds themselves. If a dev build or rebuild is required for any code change, say so, ask the user to rebuild, and provide the exact command to run.

2. When running anything that uses ports, including services, dev servers, or other long-running commands, clean up those running processes afterward so no lingering ports are left behind.
