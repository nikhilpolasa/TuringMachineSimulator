/**
 * validator.js — Semantic Validation Layer
 *
 * Runs BEFORE compilation/execution to catch:
 *   • Undefined variable references
 *   • Negative subtraction results
 *   • Invalid expressions
 *
 * Does NOT modify any existing TM logic.  This is a pure analysis pass
 * that returns a list of errors (or an empty array if all is well).
 */

class Validator {
    constructor() {
        this.errors = [];
        this.env = {};          // variable name → known numeric value (or null if unknown)
    }

    /**
     * Validate an AST (ProgramNode).
     * Returns { valid: boolean, errors: [{ line, message }] }
     */
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

    /**
     * Validate a single assignment statement.
     * Returns true if an error was found (signals caller to stop).
     */
    _validateStatement(stmt) {
        if (stmt.type !== 'Assignment') {
            this._addError(stmt.line || 1, `Unknown statement type '${stmt.type}'`);
            return true;
        }

        // Validate the right-hand side expression
        const exprResult = this._validateExpression(stmt.expression, stmt.line);
        if (exprResult.error) return true;

        // Check if the computed value is negative
        if (exprResult.value !== null && exprResult.value < 0) {
            this._addError(stmt.line,
                `Negative values not supported (result of '${stmt.variable} = ...' would be ${exprResult.value})`);
            return true;
        }

        // Register variable in environment with its computed value
        this.env[stmt.variable] = exprResult.value;
        return false;
    }

    /**
     * Validate an expression node and return { value, error }.
     * `value` is the statically-computed numeric result (null if not computable).
     * `error` is true if validation failed (error already recorded).
     */
    _validateExpression(expr, line) {
        if (!expr) {
            this._addError(line, 'Invalid expression');
            return { value: null, error: true };
        }

        // ── Number literal ──
        if (expr.type === 'NumberLiteral') {
            return { value: expr.value, error: false };
        }

        // ── Identifier (variable reference) ──
        if (expr.type === 'Identifier') {
            if (!(expr.name in this.env)) {
                this._addError(line, `Undefined variable '${expr.name}'`);
                return { value: null, error: true };
            }
            return { value: this.env[expr.name], error: false };
        }

        // ── Binary operation ──
        if (expr.type === 'BinaryOp') {
            const left = this._validateExpression(expr.left, line);
            if (left.error) return { value: null, error: true };

            const right = this._validateExpression(expr.right, line);
            if (right.error) return { value: null, error: true };

            // Try to compute the result if both sides are known
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

            // If either side is unknown, we can't statically check
            return { value: null, error: false };
        }

        this._addError(line, `Invalid expression node '${expr.type}'`);
        return { value: null, error: true };
    }

    _addError(line, message) {
        this.errors.push({ line, message });
    }
}
