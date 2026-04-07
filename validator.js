/**
 * validator.js — Semantic Validation Layer
 */

class Validator {
    constructor() {
        this.errors = [];
        this.env = {};         
    }


    validate(ast) {
        this.errors = [];
        this.env = {};

        for (const stmt of ast.statements) {
            const err = this._validateStatement(stmt);
            if (err) {
                // Stop on first error (strict mode)
                break;
            }
        }

        return {
            valid: this.errors.length === 0,
            errors: [...this.errors],
        };
    }


    _validateStatement(stmt) {
        if (stmt.type !== 'Assignment') {
            this._addError(stmt.line || 1, `Unknown statement type '${stmt.type}'`);
            return true;
        }

        const exprResult = this._validateExpression(stmt.expression, stmt.line);
        if (exprResult.error) return true;

        if (exprResult.value !== null && exprResult.value < 0) {
            this._addError(stmt.line,
                `Negative values not supported (result of '${stmt.variable} = ...' would be ${exprResult.value})`);
            return true;
        }

        this.env[stmt.variable] = exprResult.value;
        return false;
    }

    _validateExpression(expr, line) {
        if (!expr) {
            this._addError(line, 'Invalid expression');
            return { value: null, error: true };
        }

        if (expr.type === 'NumberLiteral') {
            return { value: expr.value, error: false };
        }

        if (expr.type === 'Identifier') {
            if (!(expr.name in this.env)) {
                this._addError(line, `Undefined variable '${expr.name}'`);
                return { value: null, error: true };
            }
            return { value: this.env[expr.name], error: false };
        }

        if (expr.type === 'BinaryOp') {
            const left = this._validateExpression(expr.left, line);
            if (left.error) return { value: null, error: true };

            const right = this._validateExpression(expr.right, line);
            if (right.error) return { value: null, error: true };

            if (left.value !== null && right.value !== null) {
                let result;
                switch (expr.op) {
                    case '+':
                        result = left.value + right.value;
                        break;
                    case '-':
                        result = left.value - right.value;
                        if (result < 0) {
                            this._addError(line,
                                `Negative values not supported (${left.value} - ${right.value} = ${result})`);
                            return { value: null, error: true };
                        }
                        break;
                    case '*':
                        result = left.value * right.value;
                        break;
                    default:
                        this._addError(line, `Unknown operator '${expr.op}'`);
                        return { value: null, error: true };
                }
                return { value: result, error: false };
            }

            return { value: null, error: false };
        }

        this._addError(line, `Invalid expression node '${expr.type}'`);
        return { value: null, error: true };
    }

    _addError(line, message) {
        this.errors.push({ line, message });
    }
}
