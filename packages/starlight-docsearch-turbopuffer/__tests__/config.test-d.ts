import type { z } from 'astro/zod';
import { expectTypeOf, test } from 'vitest';
import type { TurbopufferDocSearchConfigSchema, TurbopufferDocSearchUserConfig } from '../src/config';

test('the hand-written user config type matches the schema input', () => {
	expectTypeOf<TurbopufferDocSearchUserConfig>().toEqualTypeOf<
		z.input<typeof TurbopufferDocSearchConfigSchema>
	>();
});
