# CUA-checkers task manifest

This file is now a redirect. The canonical task manifest is JSON.

See `.agents/task-manifest.json`.

Rule: agents MUST NOT delete items from the manifest. Only the `status` field of an item may be updated. New items may be appended; existing items are immutable in identity. See the `rules` block in the JSON manifest for the full status enum and allowed transitions.
