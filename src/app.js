// @ts-check
// @ts-check
import { h, render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';

/** @template T @typedef {[T, import("preact/hooks").StateUpdater<T>]} StateT<T> */

// Initialize htm with Preact
export const html = htm.bind(h);

const die = why => {
  throw new Error(why);
};

const App =
  ({ renderDot }) =>
  () => {
    const [reason, setReason] = useState(/** @type {Error | null} */ (null));
    const [slogText, setSlogText] = useState(
      /** @type {string | null} */ (null),
    );

    const handler = ev => {
      const [file] = ev.target?.files;
      if (!file) {
        console.warn('no file?!');
        return;
      }
      const fr = new FileReader();
      fr.addEventListener('load', () => {
        const txt =
          typeof fr.result === 'string'
            ? fr.result
            : die(`expected string; got: ${fr.result}`);
        console.log({ txt: txt.slice(0, 80) });
        setSlogText(txt);
      });
      fr.readAsText(file);
    };

    useEffect(() => {
      if (!slogText) return;
      const lines = slogText.split('\n');
      const dot = `
      digraph {
        a -> b
        b [label="${lines.length}"]
      }
      `;
      console.log('renderDot:', dot);
      renderDot(dot);
    }, [slogText]);

    return html`
      <fieldset>
        <label
          >SLOG file: <input type="file" name="slog" onChange=${handler}
        /></label>
      </fieldset>
      <div>lines: ${slogText ? slogText.split('\n').length : ''}</div>
    `;
  };

const go = () => {
  const container = document.querySelector('#ui') || die('missing #ui');
  render(html`<${App({ renderDot: globalThis.renderDot })} />`, container);
};

go();
