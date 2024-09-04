// @ts-check
import { h, render } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import htm from 'htm';

/** @template T @typedef {[T, import("preact/hooks").StateUpdater<T>]} StateT<T> */

const { entries, fromEntries, freeze, values } = Object;

// Initialize htm with Preact
export const html = htm.bind(h);

/** @param {string} [why] */
const die = why => {
  throw new Error(why);
};
/** @type {<T,U>(x:T | undefined, f:(xx:T) => U) => U[]} */
const maybe = (x, f) => (x ? [f(x)] : []);

/**
 * @template K, V
 * @param {V[]} xs
 * @param {(v: V) => K} getKey
 * @returns {Map<K, V[]>}
 */
const groupBy = (xs, getKey) => {
  /** @type {Map<K, V[]>} */
  const m = new Map();
  for (const x of xs) {
    const key = getKey(x);
    const old = m.get(key) || [];
    m.set(key, [...old, x]);
  }
  return m;
};

/** @type {(crank: Crank) => boolean} */
const notRouting = crank => {
  const [first] = crank.events;
  return first.type !== 'crank-start' || first.crankType !== 'routing';
};

/** @param {SlogEntry} first */
const crankStartNum = first =>
  first.type === 'crank-start' ? first.crankNum : 0;

/**
 * @param {string} slogText
 * @returns {Crank[]}
 *
 * @typedef {{
 *   crankNum: number,
 *   events: Readonly<Readonly<SlogEntry>[]>,
 *   lines: Readonly<string[]>
 * }} Crank
 */
const parseCranks = slogText => {
  const lines = slogText.trim().split('\n');
  const cranks = [];
  let crankLines = [];
  let events = [];
  let crankNum = 0;
  const { freeze } = Object;
  for (const line of lines) {
    /** @type {SlogEntry} */
    const event = JSON.parse(line);
    while ((event.type === 'crank-start' ? event.crankNum : 0) > crankNum) {
      cranks.push(
        freeze({
          crankNum,
          events: freeze(events),
          lines: freeze(crankLines),
        }),
      );
      events = [];
      crankLines = [];
      crankNum += 1;
    }
    events.push(freeze(event));
    crankLines.push(line.slice(0, 1024));
  }
  if (events.length > 0) {
    cranks.push(
      freeze({
        crankNum,
        events: freeze(events),
        lines: freeze(crankLines),
      }),
    );
  }
  freeze(cranks);

  return cranks;
};

const threshold = 8;
const fmtMsg = ({ body, slots }) => {
  const bodyj = body.replace(/^#/, '');
  const [method] = JSON.parse(bodyj);
  const args = bodyj.slice(`["${method}"]`.length);
  return `.${method}(${args.slice(0, threshold)}${
    args.length > threshold ? `...${args.length}` : ''
  }, ${slots.slice(0, 3).join(',')})`;
};

const fmtDot = () => {
  const q = s => JSON.stringify(s);
  /**
   * @param {Record<string,string|number>} attrs
   * @param {string=} sep
   */
  const fmtAttrs = (attrs, sep = ', ') => {
    const es = entries(attrs);
    return es.map(([n, v]) => `${n}=${q(v)}`).join(sep);
  };
  /** @param {Record<string,string|number>} attrs */
  const withAttrs = attrs => {
    const es = entries(attrs);
    return es.length === 0 ? '' : ' [' + fmtAttrs(attrs) + ']';
  };
  /** @param {string[]} parts */
  const rec = (...parts) => parts.join('|');
  return freeze({
    /**
     * @param {Record<string, string|number>} gAttrs
     * @param {string[]} items
     */
    digraph: (gAttrs, items) => `
      digraph {
        ${fmtAttrs(gAttrs, ';\n')}
        ${items.join('\n')}
      }`,
    fmtAttrs,
    withAttrs,
    /**
     * @param {string} c
     * @param {Record<string, string>} cAttrs
     * @param {string[]} items
     */
    nodeCluster: (c, cAttrs, items) =>
      `subgraph cluster_${c} { ${fmtAttrs(
        cAttrs,
        ';\n',
      )}; node [shape=none]; ${c} [label=""]; ${[...items].join(';\n')} }`,
    arc: (src, dest, attrs = {}) => `${src} -> ${dest}` + withAttrs(attrs),
    node: (n, attrs) => n + withAttrs(attrs),
    rec,
    subRec: (...parts) => `{${rec(...parts)}}`,
    port: (port, part) => `<${port}> ${part}`,
    portRef: (node, port) => `${node}:${port}`,
  });
};

const placesIn = (
  /** @type {string} */ k,
  /** @type {unknown} */ x,
  /** @type {(string|number)[]=}*/ path = [],
) => {
  const walk = (/** @type {unknown} */ e) => {
    if (e === k) return [path];
    if (Array.isArray(e)) {
      let pos = 0;
      for (const child of e) {
        const sub = walk(child);
        if (sub.length) return [[...path, pos, ...sub[0]]];
        pos++;
      }
    } else if (e !== null && typeof e === 'object') {
      for (const [prop, val] of entries(e)) {
        const sub = walk(val);
        if (sub.length) return [[...path, prop, ...sub[0]]];
      }
    }
    return [];
  };
  return walk(x);
};

const smallCaps = {
  parseBody: body => JSON.parse(body.replace(/^#/, '')),
  asSlotRef: x => {
    if (typeof x !== 'string') return null;
    const parts = x.match(/^\$(?<ref>\d+)/);
    if (!parts) return null;
    return Number(parts?.groups?.ref);
  },
  getIFace: x => {
    const parts = x.match(/^\$\d+\.Alleged: (?<iface>.*)/);
    return parts?.groups?.iface || x;
  },
};

const theSlotRef = (target, { body, slots }) => {
  const methargs = smallCaps.parseBody(body);
  const ix = slots.findIndex(s => s === target);
  /** @returns {string | false} */
  const walk = tr => {
    if (tr === null) return false;
    else if (smallCaps.asSlotRef(tr) === ix) {
      return smallCaps.getIFace(tr);
    } else if (typeof tr === 'object') {
      if ('@qclass' in tr) {
        if (tr['@qclass'] === 'slot' && tr.index === ix)
          return tr.iface || JSON.stringify(tr);
      } else {
        for (const [prop, val] of entries(tr)) {
          const hit = walk(val);
          if (hit) return hit;
        }
      }
    } else if (Array.isArray(tr)) {
      for (const child of tr) {
        const hit = walk(child);
        if (hit) return hit;
      }
    }
    return false;
  };
  return walk(smallCaps.parseBody(body)) || die(target);
};

const unique = xs => xs.filter((x, ix, array) => array.indexOf(x) === ix);

const objInEvent = (/** @type {KoID} */ k, /** @type {SlogEntry} */ e) => {
  switch (e.type) {
    case 'deliver':
      switch (e.kd[0]) {
        case 'message':
          if (e.kd[1] === k) return [k + fmtMsg(e.kd[2].methargs)];
          if (e.kd[2].methargs.slots.includes(k)) {
            return [theSlotRef(k, e.kd[2].methargs)];
          }
          break;
        case 'notify':
          for (const [_kp, { data }] of e.kd[1]) {
            if (data.slots.includes(k)) {
              return [theSlotRef(k, data)];
            }
          }
          break;
      }
      break;
    case 'syscall': {
      switch (e.ksc[0]) {
        case 'send':
          if (e.ksc[1] === k) return [k + fmtMsg(e.ksc[2].methargs)];
          if (e.ksc[2].methargs.slots.includes(k)) {
            return [theSlotRef(k, e.ksc[2].methargs)];
          }
      }
    }
  }
  return [];
};

/**
 * @param {KoID[]} kobjs
 * @param {Crank[]} cranks
 * @param {number} cranksToShow
 */
const findUsages = (kobjs, cranks, cranksToShow) => {
  const events = cranks
    .slice(0, cranksToShow)
    .map(c => c.events)
    .flat();

  return fromEntries(
    kobjs.map(k => [k, unique(events.flatMap(e => objInEvent(k, e)))]),
  );
};

const vatColors = {
  message: 'DeepSkyBlue',
  notify: 'DarkTurquoise',
  startVat: 'Aquamarine',
  'create-vat': 'Aquamarine',
};
/**
 * @typedef {{
 *   tag: 'create-vat' | 'startVat' | 'message' | 'notify';
 *   vatID: VatID;
 *   name?: string;
 * }} Summary
 */

/** @param {Summary} summary */
const crankColor = ({ tag, vatID }) => {
  const color = vatColors[tag];
  if (!color) {
    console.warn('no color for', vatID, tag);
  }
  return color || 'orange';
};

/**
 *
 * @param {Crank[]} cranks
 * @param {number} cranksToShow
 * @param {SlogAnnotation} notes
 * @typedef {{
 *   vats: Record<VatID, string>,
 *   exports: Record<VatID, Record<KoID, string>>,
 *   objects: Record<KoID, string>,
 * }} SlogAnnotation
 */
const slogToDot = (cranks, cranksToShow, notes) => {
  /** @type {{ vatID: VatID, name?: string }[]} */
  const vats = [];
  const sends = [];
  const invokes = [];
  const msgs = [];
  const notifies = [];
  const clist = {
    imports: /**@type {SlogCListEntry[]} */ ([]),
    exports: /**@type {SlogCListEntry[]} */ ([]),
    importing: /**@type {SlogCListEntry[]} */ ([]),
  };
  /** @type {Map<string, number>} */
  const typeCounts = new Map();
  /** @type {Map<KoID | KpID, VatID>} */
  const kopToVat = new Map();
  /** @type {Map<VatID, KpID[]>} */
  const pendingPromises = new Map();
  /** @type {Map<KpID, SlogSyscallEntry & { ksc: ['send', KoID | KpID, Message] }>} */
  const pendingSends = new Map();

  const events = cranks
    .slice(0, cranksToShow)
    .map(c => c.events)
    .flat();
  const currentCrankNum = crankStartNum(cranks[cranksToShow - 1].events[0]);

  /** @type {Summary} */
  let summary;

  for (const event of events) {
    const { type } = event;
    typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    // @ts-ignore it's ok if .crankNum is undefined
    const current = event.crankNum === currentCrankNum;

    switch (type) {
      case 'create-vat':
        const { vatID, name } = event;
        vats.push({ vatID, name });
        summary = { tag: 'create-vat', vatID, name };
        break;
      case 'clist': {
        switch (event.mode) {
          case 'import':
            clist.imports.push(event);
            clist.importing.push(event);
            break;
          case 'export':
            clist.exports.push(event);
            kopToVat.set(event.kobj, event.vatID);
            break;
          // how does drop relate to import and export?
          // Is 1 drop enough to cancel out an import?
          // It seems to lose references that way.
          // case 'drop': {
          //   const ix = clist.importing.findIndex(
          //     e => e.vatID === event.vatID && e.kobj === event.kobj,
          //   );
          //   if (ix) clist.importing.splice(ix, 1);
          //   break;
          // }
        }
        break;
      }
      case 'deliver':
        switch (event.kd[0]) {
          case 'startVat': {
            const { vatID } = event;
            // const name = notes.vats[vatID];
            // vats.push({ vatID, name });
            summary = { tag: 'startVat', vatID };
            break;
          }

          case 'message': {
            const { vatID, kd, crankNum } = event;
            const [_m, target, { result }] = kd;
            kopToVat.set(target, vatID);

            if (!current) break;
            summary = { tag: 'message', vatID };
            msgs.push(event);
            break;
          }
          case 'notify': {
            const [_n, resolutions] = event.kd;
            if (current) {
              notifies.push(event);
              summary = { tag: 'notify', vatID: event.vatID };
              break;
            }
            for (const [kp] of resolutions) {
              const ps = pendingPromises.get(event.vatID) || [];
              pendingPromises.set(
                event.vatID,
                ps.filter(p => p !== kp),
              );
            }
            break;
          }
        }
        break;
      case 'syscall': {
        const { ksc } = event;
        switch (ksc[0]) {
          case 'vatstoreGet':
          case 'vatstoreGetAfter':
          case 'vatstoreSet':
            break;
          case 'invoke': {
            if (!current) break;
            invokes.push(event);
            break;
          }
          case 'send': {
            const [_s, _t, { result }] = ksc;
            kopToVat.set(result, event.vatID);
            pendingSends.set(result, { ...event, ksc });

            if (!current) break;

            sends.push(event);
            break;
          }
          case 'subscribe':
            pendingPromises.set(event.vatID, [
              ...(pendingPromises.get(event.vatID) || []),
              ksc[2],
            ]);
            break;

          default:
          // console.debug('syscall', event);
        }
        break;
      }
      default:
        break;
    }
  }
  console.log({ typeCounts });

  const pass1 = groupBy([...kopToVat.keys()], o => kopToVat.get(o) || die());
  const vatContents = new Map(
    vats.map(({ vatID: v }) => [v, pass1.get(v) || []]),
  );

  const d = fmtDot();

  const objToImpPort = new Map(
    vats.flatMap(v => {
      const cl = clist.exports.filter(
        e => e.vatID === v.vatID && !e.kobj.startsWith('kp'),
      );
      return cl.map(e => [e.kobj, d.portRef(`${v.vatID}_exports`, e.kobj)]);
    }),
  );
  console.log({
    currentCrankNum,
    pendingPromises,
    pendingSends,
    msgs,
    objToImpPort,
  });

  /** @param {KoID | KpID} id */
  const portOpt = id => objToImpPort.get(/** @type {KoID} */ (id)) || id;

  const msgArcs = msgs.map(({ kd: [_m, target, { methargs, result }] }) =>
    d.arc(kopToVat.get(result) || result, portOpt(target), {
      label: fmtMsg(methargs),
    }),
  );
  /** @param {KpID} kp */
  const pendingArc =
    kp =>
    /** @param {SlogSyscallEntry & {ksc: ['send', KoID | KpID, Message]}} e */
    e =>
      d.arc(kp, portOpt(e.ksc[1]), {
        label: fmtMsg(e.ksc[2].methargs),
        style: 'dashed',
        fontsize: 8,
      });
  const pendingSendArcs = [...pendingPromises.values()].flatMap(kps =>
    kps.flatMap(kp => maybe(pendingSends.get(kp), pendingArc(kp))),
  );

  const clistByVat = new Map(
    vats.map(v => {
      const cl = clist.exports.filter(
        e => e.vatID === v.vatID && !e.kobj.startsWith('kp'),
      );
      return [v.vatID, cl];
    }),
  );

  const importsBySrc = groupBy(
    clist.importing.filter(
      ({ kobj }) => !kobj.startsWith('kp') && !kobj.startsWith('kd'),
    ),
    e => e.vatID,
  );

  const portLabel = (vatID, kobj) => notes.exports?.[vatID]?.[kobj] || kobj;
  const clistRec = vatID =>
    d.rec(
      'exports',
      ...(clistByVat.get(vatID) || die())?.map(({ vobj, kobj }) =>
        // d.subRec(vobj, d.port(kobj, portLabel(vatID, kobj))),
        d.port(kobj, portLabel(vatID, kobj)),
      ),
    );

  const importArcs = [];
  const clusters = vats.map(({ vatID, name }) => {
    const exp = clistByVat.get(vatID);
    const internalObjects = (vatContents.get(vatID) || die(vatID)).filter(
      o => !o.startsWith('kp') && exp?.filter(e => e.kobj === o).length === 0,
    );

    const importsByDest = groupBy(importsBySrc.get(vatID) || [], e =>
      kopToVat.get(e.kobj),
    );
    const importItems = [...importsByDest.entries()].flatMap(
      ([destVat, es2]) => {
        const id = `import_${vatID}_${destVat}`;
        const rec = d.node(id, {
          shape: 'record',
          fontsize: 10,
          label: d.rec(
            `from ${destVat || '??'}`,
            ...es2.map(({ kobj }) => notes.objects[kobj] || kobj),
          ),
          href: `#${es2.map(({ kobj }) => kobj).join(',')}`,
        });
        if (destVat) {
          importArcs.push(d.arc(id, destVat, { style: 'dotted' }));
        }
        return [rec];
      },
    );

    const active = summary.vatID === vatID;
    return d.nodeCluster(
      vatID,
      {
        label: name ? `${vatID}:${name}` : vatID,
        ...(active ? { style: 'filled', color: crankColor(summary) } : {}),
      },
      [
        d.node(`${vatID}_exports`, {
          shape: 'record',
          fontsize: 10,
          label: clistRec(vatID),
        }),
        ...importItems,
        ...[
          ...internalObjects.map(d.node),
          ...(pendingPromises.get(vatID) || []).map(d.node),
        ],
      ],
    );
  });

  // const objLabels = entries(notes.objects).map(([obj, label]) =>
  //   d.node(obj, { label, shape: 'none' }),
  // );
  const pLabels = notifies.flatMap(e =>
    e.kd[1].map(r => d.node(r[0], { style: r[1] ? 'bold' : 'italic' })),
  );

  const dot = d.digraph({ rankdir: 'LR', fontsize: 10 }, [
    // ...objLabels,
    ...pLabels,
    ...clusters,
    ...pendingSendArcs,
    ...msgArcs,
    ...importArcs,
  ]);

  const skipPromise = o => !o.startsWith('kp');
  const exposedObjects = clist.importing.map(x => x.kobj).filter(skipPromise);
  const nodeInfo = vats.flatMap(({ vatID, name }) => {
    const myExported = (vatContents.get(vatID) || []).filter(o =>
      exposedObjects.includes(o),
    );
    // TODO: filter by clist exporting?
    return [{ vatID, name }, ...myExported.map(kobj => ({ kobj }))];
  });
  const renderAccessMatrix = () => {
    const blankCell = html`<td></td>`;
    const importCell = html`<td class="import">I</td>`;
    const exportCell = html`<td>o</td>`; // TODO?

    const rows = nodeInfo.map((rowHd, rowIx) => {
      const cells = nodeInfo.flatMap((colHd, colIx) => {
        if (colIx >= rowIx) return [];
        if (!('vatID' in colHd)) return [blankCell];
        if ('vatID' in rowHd) return [blankCell];
        const { kobj } = rowHd;
        const haystack = importsBySrc.get(colHd.vatID) || [];
        if (haystack.find(e => e.kobj === kobj)) return [importCell];
        // TODO: export cells?
        return [blankCell];
      });
      return html`<tr>
        ${cells}
        ${'vatID' in rowHd
          ? html`<th class="vatID">${rowHd.vatID}</th>
              <th class="vatName" colspan="4">${rowHd.name}</th>`
          : html`<th>${rowHd.kobj}</th>`}
      </tr>`;
    });
    return html`<table border="1">
      ${rows}
    </table>`;
  };

  return { dot, accessMatrix: renderAccessMatrix() };
};

const App =
  ({ renderDot, querySelector, useEvent }) =>
  () => {
    const [cranks, setCranks] = useState(
      /** @type {{ crankNum: number, events: readonly any[], lines: readonly string[] }[]} */ ([]),
    );
    const [cranksToShow, setCranksToShow] = useState(1);
    const [matrix, setMatrix] = useState(html`<table border="1"></table>`);
    const [focus, setFocus] = useState(
      /** @type {Record<string, SlogEntry[]>} */ ({}),
    );
    const [rawNotes] = useState(
      /** @type {SlogAnnotation} */ (
        JSON.parse(querySelector('textarea[name="annotations"]').value)
      ),
    );
    /** @type {SlogAnnotation} */
    const notes = {
      ...rawNotes,
      // @ts-expect-error grumble: entries() doesn't preserve the key type
      objects: fromEntries(values(rawNotes.exports).flatMap(m => entries(m))),
    };

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
        setCranks(parseCranks(txt).filter(notRouting));
      });
      fr.readAsText(file);
    };

    useEffect(() => {
      if (!cranks.length) return;
      const { dot, accessMatrix } = slogToDot(cranks, cranksToShow, notes);
      setMatrix(accessMatrix);
      if (false) {
        console.log('renderDot:', dot);
        renderDot(dot);
      }
    }, [cranks, cranksToShow]);

    useEvent('hashchange', ev => {
      const hash = ev.target.location.hash;
      const kobjs = hash.slice(1).split(',');
      const usages = findUsages(kobjs, cranks, cranksToShow);
      setFocus(usages);
      console.log('@@focus', usages);
    });

    return html`
      <fieldset>
        <label
          >SLOG file: <input type="file" name="slog" onChange=${handler}
        /></label>
        <br />
        <label
          >Show:
          <input
            type="range"
            min="1"
            max=${cranks.length}
            onChange=${e => setCranksToShow(Number(e.target.value))}
        /></label>
        <br />
        ${cranksToShow} of ${cranks.length} cranks
      </fieldset>
      <textarea rows="10" cols="120">
      ${(cranks[cranksToShow - 1]?.lines || []).join('\n')}
      </textarea
      >
      ${entries(focus).map(
        ([kobj, events]) => html`
          <div>
            <h4>
              ${kobj}${kobj in notes.objects ? `: ${notes.objects[kobj]}` : ''}
            </h4>
            <pre>
      ${events.map(e => JSON.stringify(e)).join('\n')}
      </pre
            >
          </div>
        `,
      )}
      <hr />
      ${matrix}
    `;
  };

const go = () => {
  const container = document.querySelector('#ui') || die('missing #ui');
  render(
    html`<${App({
      renderDot: globalThis.renderDot,
      querySelector: sel => document.querySelector(sel),
      useEvent: (event, handler, passive = false) => {
        useEffect(() => {
          // initiate the event handler
          window.addEventListener(event, handler, passive);

          // this will clean up the event every time the component is re-rendered
          return function cleanup() {
            window.removeEventListener(event, handler);
          };
        });
      },
    })} />`,
    container,
  );
};

go();
