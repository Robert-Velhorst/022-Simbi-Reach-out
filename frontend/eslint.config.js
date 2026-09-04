import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // These effects synchronize the UI with resolved API reads. The rule follows
      // through async loader helpers and reports valid, post-await state updates.
      'react-hooks/set-state-in-effect': 'off',
      // The shared UI module intentionally exports small formatting helpers next to
      // components; Vite still refreshes every importing boundary correctly.
      'react-refresh/only-export-components': 'off',
    },
  },
)
