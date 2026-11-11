// Stands in for the global that the Spindle worker provides to the backend.
(globalThis as unknown as { spindle: unknown }).spindle = { uuid: { v4: async () => crypto.randomUUID() } };
