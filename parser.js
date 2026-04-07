/**
 * parser.js — CFG-Based Lexer & Recursive-Descent Parser
 *
 * Grammar (CFG):
 *   Program    → Statement*
 *   Statement  → IDENTIFIER '=' Expression NEWLINE?
 *   Expression → Term (( '+' | '-' ) Term)*
 *   Term       → Factor (( '*' ) Factor)*
 *   Factor     → NUMBER | IDENTIFIER | '(' Expression ')'
 *
 * Produces an Abstract Syntax Tree (AST).
 */

//  Token Types 
const TokenType = Object.freeze({
    NUMBER:     'NUMBER',
    IDENTIFIER: 'IDENTIFIER',
    EQUALS:     'EQUALS',
    PLUS:       'PLUS',
    MINUS:      'MINUS',
    STAR:       'STAR',
    LPAREN:     'LPAREN',
    RPAREN:     'RPAREN',
    NEWLINE:    'NEWLINE',
    EOF:        'EOF',
});

class Token {
    constructor(type, value, line, col) {
        this.type  = type;
        this.value = value;
        this.line  = line;
        this.col   = col;
    }
}

//  Lexer 
class Lexer {
    constructor(source) {
        this.src = source;
        this.pos = 0;
        this.line = 1;
        this.col  = 1;
    }

    peek()    { return this.pos < this.src.length ? this.src[this.pos] : null; }
    advance() {
        const ch = this.src[this.pos++];
        if (ch === '\n') { this.line++; this.col = 1; } else { this.col++; }
        return ch;
    }
    isDigit(c) { return c >= '0' && c <= '9'; }
    isAlpha(c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'; }

    tokenize() {
        const tokens = [];
        while (this.pos < this.src.length) {
            const ch = this.peek();

            if (ch === ' ' || ch === '\t' || ch === '\r') { this.advance(); continue; }
            if (ch === '\n')  { tokens.push(new Token(TokenType.NEWLINE, '\\n', this.line, this.col)); this.advance(); continue; }
            if (ch === '=')   { tokens.push(new Token(TokenType.EQUALS, '=',  this.line, this.col)); this.advance(); continue; }
            if (ch === '+')   { tokens.push(new Token(TokenType.PLUS,   '+',  this.line, this.col)); this.advance(); continue; }
            if (ch === '-')   { tokens.push(new Token(TokenType.MINUS,  '-',  this.line, this.col)); this.advance(); continue; }
            if (ch === '*')   { tokens.push(new Token(TokenType.STAR,   '*',  this.line, this.col)); this.advance(); continue; }
            if (ch === '(')   { tokens.push(new Token(TokenType.LPAREN, '(',  this.line, this.col)); this.advance(); continue; }
            if (ch === ')')   { tokens.push(new Token(TokenType.RPAREN, ')',  this.line, this.col)); this.advance(); continue; }

            if (this.isDigit(ch)) {
                const startCol = this.col;
                let num = '';
                while (this.pos < this.src.length && this.isDigit(this.peek())) num += this.advance();
                tokens.push(new Token(TokenType.NUMBER, parseInt(num, 10), this.line, startCol));
                continue;
            }

            if (this.isAlpha(ch)) {
                const startCol = this.col;
                let id = '';
                while (this.pos < this.src.length && (this.isAlpha(this.peek()) || this.isDigit(this.peek()))) id += this.advance();
                tokens.push(new Token(TokenType.IDENTIFIER, id, this.line, startCol));
                continue;
            }

            throw new SyntaxError(`Unexpected character '${ch}' at line ${this.line}, col ${this.col}`);
        }
        tokens.push(new Token(TokenType.EOF, null, this.line, this.col));
        return tokens;
    }
}

//  AST Nodes 
class ProgramNode      { constructor(stmts)            { this.type = 'Program';       this.statements = stmts; } }
class AssignmentNode   { constructor(name, expr, line) { this.type = 'Assignment';    this.variable = name; this.expression = expr; this.line = line; } }
class BinaryOpNode     { constructor(op, left, right)  { this.type = 'BinaryOp';      this.op = op; this.left = left; this.right = right; } }
class NumberLiteralNode{ constructor(v)                 { this.type = 'NumberLiteral'; this.value = v; } }
class IdentifierNode   { constructor(n)                 { this.type = 'Identifier';    this.name = n; } }

//  Parser 
class Parser {
    constructor(tokens) { this.tokens = tokens; this.pos = 0; }

    peek()    { return this.tokens[this.pos]; }
    advance() { return this.tokens[this.pos++]; }

    expect(type) {
        const t = this.peek();
        if (t.type !== type)
            throw new SyntaxError(`Expected ${type} but got ${t.type} ('${t.value}') at line ${t.line}, col ${t.col}`);
        return this.advance();
    }

    skipNL() { while (this.peek().type === TokenType.NEWLINE) this.advance(); }

    /* Program → Statement* EOF */
    parse() {
        const stmts = [];
        this.skipNL();
        while (this.peek().type !== TokenType.EOF) {
            stmts.push(this.parseStatement());
            this.skipNL();
        }
        return new ProgramNode(stmts);
    }

    /* Statement → IDENTIFIER '=' Expression */
    parseStatement() {
        const id = this.expect(TokenType.IDENTIFIER);
        this.expect(TokenType.EQUALS);
        const expr = this.parseExpression();
        return new AssignmentNode(id.value, expr, id.line);
    }

    /* Expression → Term (( '+' | '-' ) Term )* */
    parseExpression() {
        let node = this.parseTerm();
        while (this.peek().type === TokenType.PLUS || this.peek().type === TokenType.MINUS) {
            const op = this.advance().value;
            node = new BinaryOpNode(op, node, this.parseTerm());
        }
        return node;
    }

    /* Term → Factor (( '*' ) Factor )* */
    parseTerm() {
        let node = this.parseFactor();
        while (this.peek().type === TokenType.STAR) {
            this.advance();
            node = new BinaryOpNode('*', node, this.parseFactor());
        }
        return node;
    }

    /* Factor → NUMBER | IDENTIFIER | '(' Expression ')' */
    parseFactor() {
        const t = this.peek();
        if (t.type === TokenType.NUMBER)     { this.advance(); return new NumberLiteralNode(t.value); }
        if (t.type === TokenType.IDENTIFIER) { this.advance(); return new IdentifierNode(t.value); }
        if (t.type === TokenType.LPAREN) {
            this.advance();
            const expr = this.parseExpression();
            this.expect(TokenType.RPAREN);
            return expr;
        }
        throw new SyntaxError(`Unexpected '${t.value}' at line ${t.line}, col ${t.col}. Expected number, variable, or '('`);
    }
}

//  Public API 
function parse(source) {
    const tokens = new Lexer(source).tokenize();
    return new Parser(tokens).parse();
}
