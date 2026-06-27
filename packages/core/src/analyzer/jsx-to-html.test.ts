import { describe, expect, it } from 'vitest';
import { jsxToHtml } from './jsx-to-html.js';

describe('jsxToHtml', () => {
  it('renames className/htmlFor and keeps structural attributes', () => {
    const html = jsxToHtml(
      `const A = () => <label className="f" htmlFor="email">Email</label>;`,
    );
    expect(html).toBe('<label class="f" for="email">Email</label>');
  });

  it('drops event handlers and style', () => {
    const html = jsxToHtml(`const A = () => <button onClick={x} style={{color:'red'}}>Go</button>;`);
    expect(html).toBe('<button>Go</button>');
  });

  it('emits void elements without a closing tag and preserves alt', () => {
    expect(jsxToHtml(`const A = () => <img src="a.png" alt="Logo" />;`)).toBe(
      '<img src="a.png" alt="Logo">',
    );
  });

  it('treats dynamic children as present content', () => {
    const html = jsxToHtml(`const A = ({label}) => <a href="/x">{label}</a>;`);
    expect(html).toContain('<a href="/x">');
    expect(html).not.toBe('<a href="/x"></a>');
  });

  it('renders opaque components as their children only', () => {
    const html = jsxToHtml(`const A = () => <Card><h2>Title</h2></Card>;`);
    expect(html).toBe('<h2>Title</h2>');
  });

  it('handles fragments and nesting', () => {
    const html = jsxToHtml(`const A = () => <><h1>T</h1><p>x</p></>;`);
    expect(html).toBe('<h1>T</h1><p>x</p>');
  });

  it('renders boolean attributes', () => {
    expect(jsxToHtml(`const A = () => <input type="checkbox" disabled />;`)).toBe(
      '<input type="checkbox" disabled>',
    );
  });
});
