# Security

Do not commit credentials or private runtime data.

The bridge is intended for local development. If exposing it beyond localhost or a trusted LAN, review all HTTP routes first, especially routes that enqueue commands, invoke tools, or serve generated artifacts.

