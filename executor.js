/**
 * executor.js — AST → Turing Machine Compiler
 *
 * Converts the parsed AST into a flat list of TM instructions that the
 * TuringMachine executes one-by-one.  Each instruction is a real TM
 * transition (read/write/move/branch/halt).
 *
 * TAPE LAYOUT  (compact — NO wasted cells):
 *   Position 0 … N-1  →  program variables  (one cell per variable)
 *   Position N … N+3   →  work cells W0–W3  (scratch for arithmetic)
 *
 * ARITHMETIC:
 *   Addition   a + b  →  copy a→W0, copy b→W1, loop {dec W1, inc W0} until W1==0
 *   Subtraction a - b →  copy a→W0, copy b→W1, loop {dec W1, dec W0} until W1==0
 *   Multiply   a * b  →  copy a→W0, copy b→W1, W2=0,
 *                         outer loop {dec W1, inner: add W0 to W2 via W3} → copy W2→W0
 *
 * Every head move, read, write, inc, dec is a genuine TM step visible
 * in the execution log.
 */

class Executor {
    constructor() { this.reset(); }

    reset() {
        this.varMap     = {};    // variable name → tape position
        this.nextVarPos = 0;
        this.workBase   = 0;     // set after all vars are allocated
        this.program    = [];    // instruction list being built
        this.stateId    = 0;
        this.errors     = [];
    }

    _state(label) { return `q${this.stateId++}_${label}`; }

    _allocVar(name) {
        if (!(name in this.varMap)) {
            this.varMap[name] = this.nextVarPos++;
        }
        return this.varMap[name];
    }

    // ── Instruction emitters ─────────────────────────────────
    _emit(instr) { this.program.push(instr); return this.program.length - 1; }

    _emitWrite(value, desc) {
        return this._emit({ state: this._state('write'), action: 'WRITE', value, desc });
    }
    _emitWriteAcc(desc) {
        return this._emit({ state: this._state('wAcc'), action: 'WRITE_ACC', desc });
    }
    _emitRead(desc) {
        return this._emit({ state: this._state('read'), action: 'READ', desc });
    }
    _emitMove(dir, desc) {
        return this._emit({ state: this._state('move'), action: 'MOVE', dir, desc });
    }
    _emitInc(desc) {
        return this._emit({ state: this._state('inc'), action: 'INC', desc });
    }
    _emitDec(desc) {
        return this._emit({ state: this._state('dec'), action: 'DEC', desc });
    }
    _emitBranch(cond, target, desc) {
        return this._emit({ state: this._state('br'), action: 'BRANCH', cond, target: target ?? 0, desc });
    }
    _emitHalt(desc) {
        return this._emit({ state: 'q_accept', action: 'HALT', desc });
    }

    /** Generate move sequence from `from` to `to`. */
    _emitMoveHead(from, to, reason) {
        const dist = Math.abs(to - from);
        const dir  = to > from ? DIR_RIGHT : DIR_LEFT;
        for (let i = 0; i < dist; i++) {
            this._emitMove(dir, `${reason} — move ${dir} toward cell ${to}`);
        }
    }

    // ── Public API ───────────────────────────────────────────
    compile(ast) {
        this.reset();

        // First pass: allocate ALL variables so positions are stable
        this._collectVars(ast);
        this.workBase = this.nextVarPos;   // work cells immediately after vars

        let headPos = 0;

        for (const stmt of ast.statements) {
            try {
                headPos = this._compileStmt(stmt, headPos);
            } catch (e) {
                this.errors.push(`Line ${stmt.line || '?'}: ${e.message}`);
            }
        }

        // Final HALT
        this._emitHalt('Program complete');

        // Build TM
        const tm = new TuringMachine();
        tm.program = this.program;
        tm.state   = this.program.length > 0 ? this.program[0].state : 'q_accept';

        return { tm, varMap: { ...this.varMap }, errors: [...this.errors] };
    }

    _collectVars(ast) {
        for (const stmt of ast.statements) {
            if (stmt.type === 'Assignment') this._allocVar(stmt.variable);
            this._collectExprVars(stmt.expression);
        }
    }
    _collectExprVars(expr) {
        if (!expr) return;
        if (expr.type === 'Identifier') this._allocVar(expr.name);
        if (expr.left)  this._collectExprVars(expr.left);
        if (expr.right) this._collectExprVars(expr.right);
    }

    // ── Compile statement ────────────────────────────────────
    /** Returns new headPos after compilation. */
    _compileStmt(stmt, headPos) {
        if (stmt.type !== 'Assignment') throw new Error(`Unknown statement type '${stmt.type}'`);

        const targetCell = this.varMap[stmt.variable];

        // Evaluate expression → result ends up in work cell W0
        const w0 = this.workBase;
        headPos = this._compileExpr(stmt.expression, headPos, w0);

        // Read W0 into accumulator
        this._emitMoveHead(headPos, w0, `Read result for ${stmt.variable}`);
        headPos = w0;
        this._emitRead(`Read result (W0) for ${stmt.variable}`);

        // Move to target variable cell and write accumulator
        this._emitMoveHead(headPos, targetCell, `Store → ${stmt.variable}`);
        headPos = targetCell;
        this._emitWriteAcc(`Assign ${stmt.variable} = result`);

        return headPos;
    }

    // ── Compile expression → store result in targetCell ──────
    /** Returns new head position. */
    _compileExpr(expr, headPos, targetCell) {
        // ── Number literal: just write the value directly ────
        if (expr.type === 'NumberLiteral') {
            this._emitMoveHead(headPos, targetCell, 'Write literal');
            this._emitWrite(expr.value, `Write literal ${expr.value} to cell ${targetCell}`);
            return targetCell;
        }

        // ── Variable reference: copy variable cell → targetCell ──
        if (expr.type === 'Identifier') {
            const srcCell = this.varMap[expr.name];
            if (srcCell === undefined) throw new Error(`Undefined variable '${expr.name}'`);
            return this._emitCopy(headPos, srcCell, targetCell, expr.name);
        }

        // ── Binary operation ─────────────────────────────────
        if (expr.type === 'BinaryOp') {
            const w0 = targetCell;          // left result
            const w1 = targetCell + 1;      // right result

            // Evaluate left → W0
            headPos = this._compileExpr(expr.left, headPos, w0);
            // Evaluate right → W1
            headPos = this._compileExpr(expr.right, headPos, w1);

            if (expr.op === '+') return this._emitAdd(headPos, w0, w1);
            if (expr.op === '-') return this._emitSub(headPos, w0, w1);
            if (expr.op === '*') return this._emitMul(headPos, w0, w1, w1 + 1);

            throw new Error(`Unknown operator '${expr.op}'`);
        }

        throw new Error(`Unknown AST node '${expr.type}'`);
    }

    // ── Copy cell srcCell → dstCell (non-destructive) ────────
    /**
     * Uses accumulator: read src → acc, move to dst, write acc.
     * Returns new headPos.
     */
    _emitCopy(headPos, srcCell, dstCell, label) {
        if (srcCell === dstCell) return headPos;

        this._emitMoveHead(headPos, srcCell, `Copy ${label || 'cell'}`);
        this._emitRead(`Read ${label || `cell[${srcCell}]`}`);
        this._emitMoveHead(srcCell, dstCell, `Copy → cell ${dstCell}`);
        this._emitWriteAcc(`Write ${label || 'value'} to cell ${dstCell}`);
        return dstCell;
    }

    // ── Addition: W0 += W1 (W1 becomes 0) ───────────────────
    _emitAdd(headPos, w0, w1) {
        // Move to W1 to start the loop
        this._emitMoveHead(headPos, w1, 'Addition: go to addend');

        // LOOP TOP: branch if W1 == 0 → done
        const loopTop = this.program.length;
        const branchIdx = this._emitBranch('ZERO', -1, 'Addition: check if addend is 0');  // target patched below

        // Decrement W1
        this._emitDec('Decrement addend (W1)');

        // Move to W0, increment
        this._emitMoveHead(w1, w0, 'Addition: go to accumulator');
        this._emitInc('Increment accumulator (W0)');

        // Move back to W1
        this._emitMoveHead(w0, w1, 'Addition: return to addend');

        // Jump back to loop top
        this._emitBranch('ZERO', loopTop, 'Addition: loop (always jump via fall-through)');
        // Also handle nonzero (the normal case)
        // Actually we need an unconditional jump. Use two branches:
        // Remove last branch and replace with unconditional pattern
        this.program.pop(); this.stateId--;
        // Emit a NONZERO branch to loop top (handles non-zero after dec)
        this._emitBranch('NONZERO', loopTop, 'Addition: loop back');
        // If it IS zero, also go back to loop top to re-check and exit
        this._emitBranch('ZERO', loopTop, 'Addition: loop back (final check)');

        // DONE label (patch the first branch target)
        const doneIdx = this.program.length;
        this.program[branchIdx].target = doneIdx;

        // Head is at W1, which is fine
        return w1;
    }

    // ── Subtraction: W0 -= W1 (W1 becomes 0) ────────────────
    _emitSub(headPos, w0, w1) {
        this._emitMoveHead(headPos, w1, 'Subtraction: go to subtrahend');

        const loopTop = this.program.length;
        const branchIdx = this._emitBranch('ZERO', -1, 'Subtraction: check if subtrahend is 0');

        this._emitDec('Decrement subtrahend (W1)');

        this._emitMoveHead(w1, w0, 'Subtraction: go to target');
        this._emitDec('Decrement target (W0)');

        this._emitMoveHead(w0, w1, 'Subtraction: return to subtrahend');

        this._emitBranch('NONZERO', loopTop, 'Subtraction: loop back');
        this._emitBranch('ZERO', loopTop, 'Subtraction: loop back (final check)');

        const doneIdx = this.program.length;
        this.program[branchIdx].target = doneIdx;

        return w1;
    }

    // ── Multiplication: W0 *= W1 → W0 (uses W2 as accumulator) ──
    _emitMul(headPos, w0, w1, w2) {
        // W2 = 0 (result accumulator)
        this._emitMoveHead(headPos, w2, 'Multiply: clear result');
        this._emitWrite(0, 'Clear W2 (multiplication result)');

        // Outer loop: while W1 > 0
        this._emitMoveHead(w2, w1, 'Multiply: check multiplier');
        const outerTop = this.program.length;
        const outerExit = this._emitBranch('ZERO', -1, 'Multiply: multiplier is 0?');

        // Decrement W1
        this._emitDec('Decrement multiplier (W1)');

        // Inner loop: add W0 to W2  (but we need W0 preserved!)
        // Strategy: use accumulator to copy W0 to a temp approach
        // Simpler: just do repeated INC on W2, W0 times, using a temp copy
        // We'll copy W0 to W1+2 (temp), then add temp to W2

        const wTemp = w2 + 1;
        // Copy W0 → wTemp
        headPos = this._emitCopy(w1, w0, wTemp, 'multiplicand');

        // Now add wTemp to W2 (wTemp becomes 0)
        this._emitMoveHead(wTemp, wTemp, ''); // no-op position
        const innerTop = this.program.length;
        const innerExit = this._emitBranch('ZERO', -1, 'Multiply inner: temp is 0?');

        this._emitDec('Decrement temp');
        this._emitMoveHead(wTemp, w2, 'Multiply inner: go to result');
        this._emitInc('Increment result (W2)');
        this._emitMoveHead(w2, wTemp, 'Multiply inner: return to temp');

        this._emitBranch('NONZERO', innerTop, 'Multiply inner: loop back');
        this._emitBranch('ZERO', innerTop, 'Multiply inner: loop back check');

        // Patch inner exit
        const innerDone = this.program.length;
        this.program[innerExit].target = innerDone;

        // Go back to W1 for outer loop check
        this._emitMoveHead(wTemp, w1, 'Multiply outer: return to multiplier');

        this._emitBranch('NONZERO', outerTop, 'Multiply outer: loop back');
        this._emitBranch('ZERO', outerTop, 'Multiply outer: loop back check');

        // Patch outer exit
        const outerDone = this.program.length;
        this.program[outerExit].target = outerDone;

        // Copy W2 → W0 (the final result)
        headPos = this._emitCopy(w1, w2, w0, 'product');

        return w0;
    }
}
