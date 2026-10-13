import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		typecheck: { enabled: true, include: ['__tests__/**/*.test-d.ts'] },
	},
});
