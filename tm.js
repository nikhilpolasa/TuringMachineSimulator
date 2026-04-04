/**
 * tm.js — Turing Machine Core
 *
 * Single-tape TM with:
 *   • Sparse infinite tape  (Map<int, value>)
 *   • Read / Write / Move head
 *   • Instruction list execution (each instruction = one TM transition)
 *   • Full execution log with snapshots
 *
 * Instead of a static transition table (which caused infinite-loop bugs
 * with wildcard matching), the TM now executes a linear instruction list
 * with explicit branching for loops.  Every instruction still represents
 * a genuine  δ(state, read) → (nextState, write, direction)  transition.
 */

const BLANK     = 0;
const DIR_LEFT  = 'L';
const DIR_RIGHT = 'R';
const DIR_STAY  = 'S';

class TuringMachine {
    constructor() { this.reset(); }

    reset() {
        this.tape   = new Map();   // position → integer value
        this.head   = 0;
        this.state  = 'q_init';
        this.halted = false;
        this.steps  = 0;
        this.log    = [];

        /**
         * Program: array of instruction objects.
         * Each instruction:
         * {
         *   state:     string,          — TM state label
         *   action:    'WRITE'|'MOVE'|'READ'|'BRANCH'|'HALT',
         *   value:     number|undefined, — for WRITE
         *   dir:       'L'|'R'|'S',     — for MOVE
         *   desc:      string,          — human‑readable
         *   // BRANCH only:
         *   cond:      'ZERO'|'NONZERO',
         *   target:    number,           — instruction index to jump to
         * }
         */
        this.program = [];
        this.pc      = 0;            // program counter
        this._acc    = 0;            // accumulator (for read → carry → write)
    }

    // ── Tape helpers ─────────────────────────────────────────
    read(pos) {
        const p = (pos !== undefined && pos !== null) ? pos : this.head;
        return this.tape.has(p) ? this.tape.get(p) : BLANK;
    }
    write(val, pos) {
        const p = (pos !== undefined && pos !== null) ? pos : this.head;
        this.tape.set(p, val);
    }

    // ── Execute one instruction ──────────────────────────────
    step() {
        if (this.halted) return false;
        if (this.pc >= this.program.length) {
            this.halted = true;
            this.state  = 'q_accept';
            this._logEntry('q_accept', 'End of program — HALT');
            return false;
        }

        const instr     = this.program[this.pc];
        const prevState = this.state;
        this.state      = instr.state;

        switch (instr.action) {

            case 'WRITE': {
                const readVal = this.read();
                this.write(instr.value);
                this.steps++;
                this._logTransition(prevState, instr.state, readVal, instr.value, DIR_STAY, instr.desc);
                this.pc++;
                break;
            }

            case 'WRITE_ACC': {
                // Write the accumulator value to the current head cell
                const readVal = this.read();
                this.write(this._acc);
                this.steps++;
                this._logTransition(prevState, instr.state, readVal, this._acc, DIR_STAY, instr.desc);
                this.pc++;
                break;
            }

            case 'READ': {
                // Read current cell into accumulator
                this._acc = this.read();
                this.steps++;
                this._logTransition(prevState, instr.state, this._acc, this._acc, DIR_STAY,
                    instr.desc || `Read ${this._acc} into accumulator`);
                this.pc++;
                break;
            }

            case 'MOVE': {
                const readVal = this.read();
                if (instr.dir === DIR_RIGHT) this.head++;
                else if (instr.dir === DIR_LEFT) this.head--;
                this.steps++;
                this._logTransition(prevState, instr.state, readVal, readVal, instr.dir, instr.desc);
                this.pc++;
                break;
            }

            case 'INC': {
                const readVal = this.read();
                this.write(readVal + 1);
                this.steps++;
                this._logTransition(prevState, instr.state, readVal, readVal + 1, DIR_STAY,
                    instr.desc || `Increment cell → ${readVal + 1}`);
                this.pc++;
                break;
            }

            case 'DEC': {
                const readVal = this.read();
                const nv = Math.max(0, readVal - 1);
                this.write(nv);
                this.steps++;
                this._logTransition(prevState, instr.state, readVal, nv, DIR_STAY,
                    instr.desc || `Decrement cell → ${nv}`);
                this.pc++;
                break;
            }

            case 'BRANCH': {
                // Conditional jump — does NOT consume a step itself (it's control flow)
                const cellVal = this.read();
                let jump = false;
                if (instr.cond === 'ZERO'    && cellVal === 0)  jump = true;
                if (instr.cond === 'NONZERO' && cellVal !== 0)  jump = true;
                if (jump) {
                    this.pc = instr.target;
                } else {
                    this.pc++;
                }
                break;
            }

            case 'HALT': {
                this.halted = true;
                this.state  = 'q_accept';
                this.steps++;
                this._logEntry('q_accept', instr.desc || 'HALT — program complete');
                return false;
            }

            default:
                this.pc++;
        }

        if (this.state === 'q_accept') { this.halted = true; return false; }
        return !this.halted;
    }

    // ── Logging ──────────────────────────────────────────────
    _logTransition(fromState, toState, readVal, writeVal, dir, desc) {
        this.log.push({
            step:       this.steps,
            fromState,
            toState,
            read:       readVal,
            write:      writeVal,
            dir,
            head:       this.head,
            desc:       desc || '',
            transition: `δ(${fromState}, ${this._fmt(readVal)}) → (${toState}, ${this._fmt(writeVal)}, ${dir})`,
            snapshot:   this.getSnapshot(),
        });
    }

    _logEntry(state, desc) {
        this.log.push({
            step:       this.steps,
            fromState:  state,
            toState:    state,
            read:       '',
            write:      '',
            dir:        DIR_STAY,
            head:       this.head,
            desc,
            transition: `→ ${state}`,
            snapshot:   this.getSnapshot(),
        });
    }

    _fmt(s) { return s === BLANK ? '□' : String(s); }

    // ── Snapshots ────────────────────────────────────────────
    getSnapshot() {
        const keys = [...this.tape.keys(), this.head];
        const lo   = Math.min(...keys, 0) - 3;
        const hi   = Math.max(...keys, 0) + 3;
        const cells = [];
        for (let i = lo; i <= hi; i++) cells.push({ pos: i, val: this.read(i) });
        return { cells, head: this.head, state: this.state };
    }

    getBounds() {
        const keys = [...this.tape.keys(), this.head];
        return { lo: Math.min(...keys, 0) - 4, hi: Math.max(...keys, 0) + 4 };
    }
}
