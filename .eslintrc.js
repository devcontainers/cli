module.exports = {
    'env': {
        'browser': true,
        'node': true
    },
    'parser': '@typescript-eslint/parser',
    'parserOptions': {
        'sourceType': 'module'
    },
    'plugins': [
        '@typescript-eslint',
        '@stylistic'
    ],
    'rules': {
        // '@typescript-eslint/class-name-casing': 'warn', https://github.com/typescript-eslint/typescript-eslint/issues/2077
        '@stylistic/member-delimiter-style': [
            'warn',
            {
                'multiline': {
                    'delimiter': 'semi',
                    'requireLast': true
                },
                'singleline': {
                    'delimiter': 'semi',
                    'requireLast': false
                }
            }
        ],
        'semi': [
            'warn',
            'always'
        ],
        'constructor-super': 'warn',
        'curly': 'warn',
        'eqeqeq': [
            'warn',
            'always'
        ],
        'no-async-promise-executor': 'warn',
        'no-buffer-constructor': 'warn',
        'no-caller': 'warn',
        'no-debugger': 'warn',
        'no-duplicate-case': 'warn',
        'no-duplicate-imports': 'warn',
        'no-eval': 'warn',
        'no-extra-semi': 'warn',
        'no-new-wrappers': 'warn',
        'no-redeclare': 'off',
        'no-sparse-arrays': 'warn',
        'no-throw-literal': 'warn',
        'no-unsafe-finally': 'warn',
        'no-unused-labels': 'warn',
        '@typescript-eslint/no-redeclare': 'warn',
        'code-no-unexternalized-strings': 'warn',
        'no-throw-literal': 'warn',
        'no-var': 'warn',
        'code-no-unused-expressions': [
            'warn',
            {
                'allowTernary': true
            }
        ],
    }
};
