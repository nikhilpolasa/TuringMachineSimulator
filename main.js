/**
 * main.js — Application orchestrator
 * Wires  parser → executor → TM → UI.
 *
 * Enhancements:
 *   • Phase tracking (Reading / Writing / Moving / Halting)
 *   • Written-cell flash animations forwarded to UI
 *   • Halt banner display
 *   • Current transition display updated each step
 *   • Safety cap on branch-skip loops to prevent UI freeze
 */

(function () {
    'use strict';

    let ui;
    let tm      = null;
    let varMap  = null;
    let running = false;
    let timerId = null;

    // ── Initialise ───────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        ui = new UI();

        ui.btnRun.addEventListener('click',   onRun);
        ui.btnPause.addEventListener('click', onPause);
        ui.btnStep.addEventListener('click',  onStep);
        ui.btnReset.addEventListener('click', onReset);
        ui.speedSlider.addEventListener('input', () => ui.updateSpeedLabel());

        // Pre-fill example
        ui.codeEditor.value = `x = 3\ny = x + 2\nz = y - 1`;

        ui.updateSpeedLabel();
        showIdle();
    });

    // ── Compile ──────────────────────────────────────────────
    function compile() {
        ui.clearError();
        ui.clearLog();
        ui.resetUIState();
        const source = ui.codeEditor.value.trim();
        if (!source) { ui.showError('Code editor is empty.'); return false; }

        try {
            const ast    = parse(source);
            const exec   = new Executor();
            const result = exec.compile(ast);

            if (result.errors.length) {
                ui.showError(result.errors.join('\n'));
                return false;
            }

            tm     = result.tm;
            varMap = result.varMap;

            ui.renderTape(tm, varMap);
            ui.renderState(tm.state);
            ui.renderStep(tm.steps);
            ui.renderPhase('Ready');
            ui.renderVariables(tm, varMap);
            ui.renderTransition(null);
            ui.setReady();
            return true;
        } catch (e) {
            ui.showError(e.message);
            return false;
        }
    }

    // ── Controls ─────────────────────────────────────────────
    function onRun() {
        if (!tm) { if (!compile()) return; }
        if (tm.halted) return;
        running = true;
        ui.setRunning(true);
        tick();
    }

    function onPause() {
        running = false;
        clearTimeout(timerId);
        ui.setRunning(false);
        ui.setReady();
        if (tm && tm.halted) ui.setHalted();
    }

    function onStep() {
        if (!tm) { if (!compile()) return; }
        if (tm.halted) return;
        doStep();
    }

    function onReset() {
        running = false;
        clearTimeout(timerId);
        tm     = null;
        varMap = null;
        ui.clearLog();
        ui.clearError();
        ui.resetUIState();
        showIdle();
    }

    // ── Execution loop ───────────────────────────────────────
    function tick() {
        if (!running || !tm || tm.halted) { onPause(); return; }
        doStep();
        if (tm.halted) { onPause(); return; }
        timerId = setTimeout(tick, ui.getDelay());
    }

    /**
     * Execute one visible TM step.
     * BRANCH instructions are invisible (control flow), so we loop
     * inside tm.step() until a visible step is produced.
     */
    function doStep() {
        let attempts = 0;
        const prevLogLen = tm.log.length;

        while (attempts < 200) {
            attempts++;
            const continued = tm.step();

            // A new log entry means a visible step happened
            if (tm.log.length > prevLogLen) {
                const lastLog = tm.log[tm.log.length - 1];

                // Determine phase and mark written cell
                const phase = detectPhase(lastLog);
                if (phase === 'Writing' || phase === 'Assigning') {
                    ui.markWritten(lastLog.head);
                }

                ui.renderPhase(phase);
                ui.renderTape(tm, varMap);
                ui.renderState(tm.state);
                ui.renderStep(tm.steps);
                ui.renderVariables(tm, varMap);
                ui.renderTransition(lastLog);
                ui.appendLog(lastLog);

                if (!continued || tm.halted) {
                    handleHalt();
                }
                return;
            }

            if (!continued || tm.halted) {
                // Halted without a visible step (unlikely but safe)
                handleHalt();
                return;
            }
        }

        // Safety: branch loop ran too long
        ui.showError('Execution stalled — possible infinite branch loop.');
        handleHalt();
    }

    function handleHalt() {
        ui.renderTape(tm, varMap);
        ui.renderState(tm.state);
        ui.renderStep(tm.steps);
        ui.renderVariables(tm, varMap);
        ui.renderPhase('Halted');
        ui.setHalted();
        ui.showHaltBanner();
        running = false;
    }

    /** Determine the current execution phase from a log entry. */
    function detectPhase(entry) {
        if (!entry) return 'Idle';
        const d = (entry.desc || '').toLowerCase();
        if (entry.toState === 'q_accept' || d.includes('halt'))   return 'Halted';
        if (d.includes('assign'))                                   return 'Assigning';
        if (d.includes('write'))                                    return 'Writing';
        if (d.includes('read'))                                     return 'Reading';
        if (d.includes('move'))                                     return 'Moving';
        if (d.includes('increment') || d.includes('inc'))           return 'Computing';
        if (d.includes('decrement') || d.includes('dec'))           return 'Computing';
        return 'Executing';
    }

    // ── Idle state ───────────────────────────────────────────
    function showIdle() {
        const dummy = new TuringMachine();
        ui.renderTape(dummy, {});
        ui.renderState('—');
        ui.renderStep(0);
        ui.renderPhase('Idle');
        ui.renderVariables(dummy, {});
        ui.renderTransition(null);
        ui.setReady();
    }
})();
