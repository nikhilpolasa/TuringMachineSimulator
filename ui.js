/**
 * ui.js — Rendering, animation, and DOM interaction
 */

class UI {
    constructor() {
        // Panels
        this.codeEditor        = document.getElementById('code-editor');
        this.lineHighlights    = document.getElementById('editor-line-highlights');
        this.tapeContainer     = document.getElementById('tape-container');
        this.stateDisplay      = document.getElementById('state-display');
        this.stepDisplay       = document.getElementById('step-counter');
        this.phaseDisplay      = document.getElementById('phase-display');
        this.logPanel          = document.getElementById('log-panel');
        this.errorPanel        = document.getElementById('error-panel');
        this.varsPanel         = document.getElementById('vars-panel');
        this.speedSlider       = document.getElementById('speed-slider');
        this.speedLabel        = document.getElementById('speed-label');
        this.transitionDisplay = document.getElementById('transition-display');
        this.haltBanner        = document.getElementById('halt-banner');

        // Buttons
        this.btnRun   = document.getElementById('btn-run');
        this.btnPause = document.getElementById('btn-pause');
        this.btnStep  = document.getElementById('btn-step');
        this.btnReset = document.getElementById('btn-reset');

        this._prevVarVals = {};
        this._lastWrittenPos = null;
        this._prevHeadPos = null;

        if (this.codeEditor && this.lineHighlights) {
            this.codeEditor.addEventListener('scroll', () => {
                this.lineHighlights.scrollTop = this.codeEditor.scrollTop;
            });
        }
    }

    //  Tape rendering 
    renderTape(tm, varMap, lastAction) {
        const bounds  = tm.getBounds();
        const headPos = tm.head;

        // Determine labelled positions
        const posLabels = {};
        if (varMap) {
            for (const [name, pos] of Object.entries(varMap)) {
                posLabels[pos] = name;
            }
        }

        const headMoved = (this._prevHeadPos !== null && this._prevHeadPos !== headPos);

        let html = '<div class="tape-strip">';
        for (let i = bounds.lo; i <= bounds.hi; i++) {
            const val      = tm.read(i);
            const isHead   = i === headPos;
            const label    = posLabels[i] || '';
            const displayVal = val === 0 && !tm.tape.has(i) ? '□' : val;
            const isWritten = (i === this._lastWrittenPos);

            let cls = 'tape-cell';
            if (isHead)    cls += ' head';
            if (label)     cls += ' labelled';
            if (isWritten) cls += ' just-written';
            if (isHead && headMoved) cls += ' head-entering';

            html += `<div class="${cls}" data-pos="${i}">
                        <span class="cell-label">${label}</span>
                        <span class="cell-value">${displayVal}</span>
                        <span class="cell-pos">${i}</span>
                     </div>`;
        }
        html += '</div>';
        html += '<div class="head-indicator">▲ Head</div>';

        this.tapeContainer.innerHTML = html;

        this._prevHeadPos = headPos;

        this._lastWrittenPos = null;

        requestAnimationFrame(() => {
            const headCell = this.tapeContainer.querySelector('.tape-cell.head');
            if (headCell) {
                headCell.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
            }
        });
    }

    markWritten(pos) {
        this._lastWrittenPos = pos;
    }

    renderState(state) {
        this.stateDisplay.textContent = state;

        // Halted green glow
        if (state === 'q_accept') {
            this.stateDisplay.classList.add('halted');
        } else {
            this.stateDisplay.classList.remove('halted');
            this.stateDisplay.classList.remove('glow-pulse');
            void this.stateDisplay.offsetWidth; // reflow
            this.stateDisplay.classList.add('glow-pulse');
        }
    }

    renderStep(n) {
        this.stepDisplay.textContent = n;
    }

    renderPhase(phase) {
        if (this.phaseDisplay) {
            this.phaseDisplay.textContent = phase;
        }
    }

    //  Current Transition Display 
    renderTransition(entry) {
        if (!entry) {
            this.transitionDisplay.innerHTML =
                '<span class="transition-idle">Press <strong>Run</strong> or <strong>Step</strong> to begin</span>';
            return;
        }

        const fmtSym = (s) => (s === 0 || s === '') ? '□' : s;

        // Halted
        if (entry.toState === 'q_accept' && (entry.read === '' || entry.fromState === 'q_accept')) {
            this.transitionDisplay.innerHTML =
                `<span class="t-to">q_accept</span>
                 <span class="t-desc">— ${entry.desc}</span>`;
            this._flashTransition();
            return;
        }

        this.transitionDisplay.innerHTML =
            `<span class="t-from">(${entry.fromState},</span>
             <span class="t-read">${fmtSym(entry.read)}</span><span class="t-from">)</span>
             <span class="t-arrow">→</span>
             <span class="t-to">(${entry.toState},</span>
             <span class="t-write">${fmtSym(entry.write)},</span>
             <span class="t-dir">${entry.dir}</span><span class="t-to">)</span>
             <span class="t-desc">${entry.desc}</span>`;

        this._flashTransition();
    }

    _flashTransition() {
        this.transitionDisplay.classList.remove('flash');
        void this.transitionDisplay.offsetWidth; // reflow to restart animation
        this.transitionDisplay.classList.add('flash');
    }

    //  Halt Banner 
    showHaltBanner() {
        this.haltBanner.classList.remove('hidden');
    }
    hideHaltBanner() {
        this.haltBanner.classList.add('hidden');
    }

    //  Variables panel with hover linking 
    renderVariables(tm, varMap) {
        if (!varMap || Object.keys(varMap).length === 0) {
            this.varsPanel.innerHTML = '<span class="empty-hint">No variables yet</span>';
            return;
        }

        let html = '<table class="var-table"><tr><th>Variable</th><th>Cell</th><th>Value</th></tr>';
        for (const [name, pos] of Object.entries(varMap)) {
            const val     = tm.read(pos);
            const prevVal = this._prevVarVals[name];
            const changed = (prevVal !== undefined && prevVal !== val);

            html += `<tr data-var-cell="${pos}">
                        <td class="var-name">${name}</td>
                        <td class="var-cell">${pos}</td>
                        <td class="var-val${changed ? ' changed' : ''}">${val}</td>
                     </tr>`;

            this._prevVarVals[name] = val;
        }
        html += '</table>';
        this.varsPanel.innerHTML = html;

        this.varsPanel.querySelectorAll('tr[data-var-cell]').forEach(row => {
            const cellPos = parseInt(row.dataset.varCell, 10);

            row.addEventListener('mouseenter', () => {
                const tapeCell = this.tapeContainer.querySelector(`.tape-cell[data-pos="${cellPos}"]`);
                if (tapeCell) tapeCell.classList.add('highlight-link');
                row.classList.add('var-active');
            });

            row.addEventListener('mouseleave', () => {
                const tapeCell = this.tapeContainer.querySelector(`.tape-cell[data-pos="${cellPos}"]`);
                if (tapeCell) tapeCell.classList.remove('highlight-link');
                row.classList.remove('var-active');
            });
        });
    }

    clearLog() { this.logPanel.innerHTML = ''; }

    appendLog(entry) {
        const div = document.createElement('div');
        div.className = 'log-entry ' + this._logClass(entry);
        div.innerHTML = `<span class="log-step">#${entry.step}</span>
                         <span class="log-transition">${entry.transition}</span>
                         <span class="log-desc">${entry.desc}</span>`;
        this.logPanel.appendChild(div);
        this.logPanel.scrollTop = this.logPanel.scrollHeight;
    }

    _logClass(entry) {
        const d = (entry.desc || '').toLowerCase();
        const t = (entry.transition || '').toLowerCase();

        if (entry.toState === 'q_accept' || d.includes('halt'))   return 'log-halt';
        if (d.includes('write') || d.includes('assign'))          return 'log-write';
        if (d.includes('move'))                                    return 'log-move';
        if (d.includes('read'))                                    return 'log-read';
        if (d.includes('increment') || d.includes('inc'))          return 'log-inc';
        if (d.includes('decrement') || d.includes('dec'))          return 'log-dec';
        return '';
    }

    //  Error display 
    showError(msg) {
        this.errorPanel.textContent = msg;
        this.errorPanel.classList.add('visible');
    }
    clearError() {
        this.errorPanel.textContent = '';
        this.errorPanel.classList.remove('visible');
    }

    //  Error line highlighting 
    highlightErrorLine(lineNum) {
        if (!this.lineHighlights || !this.codeEditor) return;

        // Get computed line-height of the textarea
        const cs = window.getComputedStyle(this.codeEditor);
        const lineHeight = parseFloat(cs.lineHeight) || (parseFloat(cs.fontSize) * 1.65);
        const paddingTop = parseFloat(cs.paddingTop) || 0;

        const marker = document.createElement('div');
        marker.className = 'error-line-marker';
        marker.style.top  = `${paddingTop + (lineNum - 1) * lineHeight}px`;
        marker.style.height = `${lineHeight}px`;

        this.lineHighlights.appendChild(marker);

        // Sync scroll position
        this.lineHighlights.scrollTop = this.codeEditor.scrollTop;
    }

    clearLineHighlights() {
        if (this.lineHighlights) {
            this.lineHighlights.innerHTML = '';
        }
    }

    //  Button states 
    setRunning(running) {
        this.btnRun.disabled   = running;
        this.btnPause.disabled = !running;
        this.btnStep.disabled  = running;
        this.btnRun.classList.toggle('active', running);
    }
    setHalted() {
        this.btnRun.disabled   = true;
        this.btnPause.disabled = true;
        this.btnStep.disabled  = true;
    }
    setReady() {
        this.btnRun.disabled   = false;
        this.btnPause.disabled = true;
        this.btnStep.disabled  = false;
    }

    //  Speed 
    getDelay() {
        // slider 1 (slow) … 100 (fast)  →  delay 1200ms … 25ms
        const v = parseInt(this.speedSlider.value, 10);
        return Math.round(1200 - (v / 100) * 1175);
    }
    updateSpeedLabel() {
        this.speedLabel.textContent = `${this.speedSlider.value}%`;
    }

    resetUIState() {
        this._prevVarVals    = {};
        this._lastWrittenPos = null;
        this._prevHeadPos    = null;
        this.hideHaltBanner();
        this.renderTransition(null);
        this.renderPhase('Idle');
        this.stateDisplay.classList.remove('halted');
        this.clearLineHighlights();
    }
}
