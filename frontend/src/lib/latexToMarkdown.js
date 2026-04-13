function readBalanced(text, start, openChar, closeChar) {
  if (text[start] !== openChar) return null;
  let depth = 0;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    const previous = text[index - 1];

    if (char === openChar && previous !== '\\') {
      depth += 1;
    } else if (char === closeChar && previous !== '\\') {
      depth -= 1;
      if (depth === 0) {
        return {
          content: text.slice(start + 1, index),
          end: index + 1,
        };
      }
    }
  }

  return null;
}

function stripLatexComments(source) {
  return source
    .split('\n')
    .map((line) => {
      let output = '';
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const previous = line[index - 1];
        if (char === '%' && previous !== '\\') {
          break;
        }
        output += char;
      }
      return output;
    })
    .join('\n');
}

function replaceScientificUnits(source) {
  const unitMap = [
    [/\\degreeCelsius\b/g, '°C'],
    [/\\percent\b/g, '%'],
    [/\\micro\\metre\b/g, 'µm'],
    [/\\micro\\meter\b/g, 'µm'],
    [/\\metre\b/g, 'm'],
    [/\\meter\b/g, 'm'],
    [/\\centi\\metre\b/g, 'cm'],
    [/\\centi\\meter\b/g, 'cm'],
    [/\\milli\\second\b/g, 'ms'],
    [/\\second\b/g, 's'],
    [/\\fps\b/g, 'fps'],
    [/\\ms\b/g, 'ms'],
    [/\\cm\b/g, 'cm'],
    [/\\micro\b/g, 'µ'],
  ];

  const renderUnit = (rawUnit) => {
    let unit = rawUnit || '';
    unitMap.forEach(([pattern, replacement]) => {
      unit = unit.replace(pattern, replacement);
    });
    unit = unit
      .replace(/\\,/g, ' ')
      .replace(/\\;/g, ' ')
      .replace(/\\:/g, ' ')
      .replace(/\\!/g, '')
      .replace(/[{}]/g, '')
      .replace(/\\/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return unit;
  };

  let text = source;

  text = text.replace(/\\SIrange\{([^{}]+)\}\{([^{}]+)\}\{([^{}]*)\}/g, (_, from, to, unit) => {
    const renderedUnit = renderUnit(unit);
    return renderedUnit ? `${from}–${to} ${renderedUnit}` : `${from}–${to}`;
  });

  text = text.replace(/\\SI\{([^{}]+)\}\{([^{}]*)\}/g, (_, value, unit) => {
    const renderedUnit = renderUnit(unit);
    return renderedUnit ? `${value} ${renderedUnit}` : value;
  });

  text = text.replace(/\\si\{([^{}]*)\}/g, (_, unit) => renderUnit(unit));

  return text;
}

function protectMathSegments(source) {
  const placeholders = [];
  let text = source;

  const protect = (pattern) => {
    text = text.replace(pattern, (match) => {
      const token = `@@MATH_${placeholders.length}@@`;
      placeholders.push(match);
      return token;
    });
  };

  protect(/\\\[((?:.|\n|\r)*?)\\\]/g);
  protect(/\\\(((?:\\.|[^\\)])+?)\\\)/g);
  protect(/\$\$([\s\S]+?)\$\$/g);
  protect(/\$([^$\n]+?)\$/g);

  return {
    text,
    restore(value) {
      return value.replace(/@@MATH_(\d+)@@/g, (_, index) => placeholders[Number(index)] || '');
    },
  };
}

function replaceCommandWithGroup(text, command, replacer) {
  let output = '';
  let cursor = 0;

  while (cursor < text.length) {
    const marker = `\\${command}`;
    const index = text.indexOf(marker, cursor);
    if (index === -1) {
      output += text.slice(cursor);
      break;
    }

    output += text.slice(cursor, index);
    let next = index + marker.length;

    while (/\s/.test(text[next] || '')) next += 1;

    if (text[next] === '[') {
      const optionalGroup = readBalanced(text, next, '[', ']');
      if (optionalGroup) {
        next = optionalGroup.end;
        while (/\s/.test(text[next] || '')) next += 1;
      }
    }

    if (text[next] !== '{') {
      output += marker;
      cursor = index + marker.length;
      continue;
    }

    const group = readBalanced(text, next, '{', '}');
    if (!group) {
      output += marker;
      cursor = index + marker.length;
      continue;
    }

    output += replacer(group.content);
    cursor = group.end;
  }

  return output;
}

function replaceCommandWithTwoGroups(text, command, replacer) {
  let output = '';
  let cursor = 0;

  while (cursor < text.length) {
    const marker = `\\${command}`;
    const index = text.indexOf(marker, cursor);
    if (index === -1) {
      output += text.slice(cursor);
      break;
    }

    output += text.slice(cursor, index);
    let next = index + marker.length;

    while (/\s/.test(text[next] || '')) next += 1;
    if (text[next] !== '{') {
      output += marker;
      cursor = index + marker.length;
      continue;
    }

    const first = readBalanced(text, next, '{', '}');
    if (!first) {
      output += marker;
      cursor = index + marker.length;
      continue;
    }

    next = first.end;
    while (/\s/.test(text[next] || '')) next += 1;
    if (text[next] !== '{') {
      output += marker + text.slice(index + marker.length, first.end);
      cursor = first.end;
      continue;
    }

    const second = readBalanced(text, next, '{', '}');
    if (!second) {
      output += marker + text.slice(index + marker.length, first.end);
      cursor = first.end;
      continue;
    }

    output += replacer(first.content, second.content);
    cursor = second.end;
  }

  return output;
}

function extractFirstCommandGroup(text, command) {
  const marker = `\\${command}`;
  const index = text.indexOf(marker);
  if (index === -1) return null;

  let cursor = index + marker.length;
  while (/\s/.test(text[cursor] || '')) cursor += 1;
  if (text[cursor] !== '{') return null;

  const group = readBalanced(text, cursor, '{', '}');
  return group ? group.content : null;
}

function removeCommandDefinition(text, command) {
  const marker = `\\${command}`;
  let output = '';
  let cursor = 0;

  while (cursor < text.length) {
    const index = text.indexOf(marker, cursor);
    if (index === -1) {
      output += text.slice(cursor);
      break;
    }

    output += text.slice(cursor, index);
    let next = index + marker.length;
    while (/\s/.test(text[next] || '')) next += 1;

    if (text[next] === '[') {
      const optionalGroup = readBalanced(text, next, '[', ']');
      if (optionalGroup) {
        next = optionalGroup.end;
        while (/\s/.test(text[next] || '')) next += 1;
      }
    }

    if (text[next] === '{') {
      const group = readBalanced(text, next, '{', '}');
      if (group) {
        cursor = group.end;
        continue;
      }
    }

    cursor = index + marker.length;
  }

  return output;
}

function replaceEnvironment(text, name, replacer) {
  const pattern = new RegExp(`\\\\begin\\{${name}\\}(?:\\[[^\\]]*\\])?(?:\\{[^}]*\\})?([\\s\\S]*?)\\\\end\\{${name}\\}`, 'g');
  let previous;
  let current = text;

  do {
    previous = current;
    current = current.replace(pattern, (_, content) => replacer(content));
  } while (current !== previous);

  return current;
}

function splitLatexItems(content) {
  const itemPattern = /\\item(?:\s*\[([^\]]+)\])?/g;
  const items = [];
  let match;
  let currentLabel = null;
  let currentStart = null;

  while ((match = itemPattern.exec(content)) !== null) {
    if (currentStart !== null) {
      items.push({
        label: currentLabel,
        body: content.slice(currentStart, match.index),
      });
    }
    currentLabel = match[1] || null;
    currentStart = itemPattern.lastIndex;
  }

  if (currentStart !== null) {
    items.push({
      label: currentLabel,
      body: content.slice(currentStart),
    });
  }

  return items;
}

function cleanupInlineSpacing(text) {
  return text
    .replace(/\\([#$%&_{}])/g, '$1')
    .replace(/\\,/g, ' ')
    .replace(/\\;/g, ' ')
    .replace(/\\:/g, ' ')
    .replace(/\\!/g, '')
    .replace(/\\quad\b/g, '  ')
    .replace(/\\qquad\b/g, '    ')
    .replace(/~+/g, ' ')
    .replace(/\\ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function unwrapOuterBraces(text) {
  let current = text.trim();

  while (current.startsWith('{') && current.endsWith('}')) {
    const group = readBalanced(current, 0, '{', '}');
    if (!group || group.end !== current.length) {
      break;
    }
    current = group.content.trim();
  }

  return current;
}

function stripWrappedMarkdownEmphasis(text) {
  let current = (text || '').trim();

  if (current.startsWith('**') && current.endsWith('**') && current.length >= 4) {
    current = current.slice(2, -2).trim();
  } else if (current.startsWith('*') && current.endsWith('*') && current.length >= 2) {
    current = current.slice(1, -1).trim();
  }

  return current;
}

function normalizePairedMathPipes(expression) {
  let current = expression;
  let previous;

  do {
    previous = current;
    current = current.replace(/\|([^|\n]+?)\|/g, (_, inner) => `\\lvert ${inner.trim()}\\rvert`);
  } while (current !== previous);

  return current;
}

function convertInlineLatex(text) {
  let current = text;

  const inlineConverters = [
    ['textbf', (value) => `**${convertInlineLatex(value)}**`],
    ['textit', (value) => `*${convertInlineLatex(value)}*`],
    ['emph', (value) => `*${convertInlineLatex(value)}*`],
    ['underline', (value) => `_${convertInlineLatex(value)}_`],
    ['texttt', (value) => `\`${convertInlineLatex(value)}\``],
    ['textsuperscript', (value) => {
      const superscripts = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾' };
      const rendered = value.split('').map((char) => superscripts[char]).join('');
      return rendered && !rendered.includes('undefined') ? rendered : ` (${convertInlineLatex(value)})`;
    }],
  ];

  inlineConverters.forEach(([command, replacer]) => {
    current = replaceCommandWithGroup(current, command, replacer);
  });

  current = replaceCommandWithTwoGroups(current, 'href', (href, label) => `[${convertInlineLatex(label)}](${href.trim()})`);
  current = replaceCommandWithGroup(current, 'url', (href) => `<${href.trim()}>`);

  current = current.replace(/~?\\ref\{[^}]+\}/g, '');
  current = current.replace(/\\\\(?:\[[^\]]*])?/g, '  \n');
  current = current.replace(/\\rule\s*\{[^}]*\}\s*\{[^}]*\}/g, '\n---\n');
  current = current.replace(/\\(small|large|Large|LARGE|huge|Huge|normalsize|centering|noindent|vfill|par)\b/g, '');
  current = current.replace(/\\vspace\*?\{[^}]*\}/g, '');
  current = current.replace(/\\thispagestyle\{[^}]*\}/g, '');

  return cleanupInlineSpacing(unwrapOuterBraces(current));
}

function compactBlockText(text) {
  return convertBlockLatex(text)
    .replace(/\n{2,}/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function convertItemize(content) {
  return splitLatexItems(content)
    .map((item) => `- ${compactBlockText(item.body)}`)
    .join('\n');
}

function convertEnumerate(content) {
  return splitLatexItems(content)
    .map((item) => `1. ${compactBlockText(item.body)}`)
    .join('\n');
}

function convertDescription(content) {
  return splitLatexItems(content)
    .map((item) => {
      const label = item.label ? convertInlineLatex(item.label) : '';
      const body = compactBlockText(item.body);
      return `- **${label}**${body ? `: ${body}` : ''}`;
    })
    .join('\n');
}

function convertTabular(content) {
  let cleaned = content
    .replace(/\\(toprule|midrule|bottomrule)\b/g, '')
    .trim();

  if (cleaned.startsWith('{')) {
    const alignmentGroup = readBalanced(cleaned, 0, '{', '}');
    if (alignmentGroup) {
      cleaned = cleaned.slice(alignmentGroup.end).trim();
    }
  }

  const rows = cleaned
    .split(/\\\\(?:\[[^\]]*])?/)
    .map((row) => row.trim())
    .filter(Boolean);

  if (rows.length === 0) return '';

  const cells = rows.map((row) =>
    row
      .split(/\s*&\s*/)
      .map((cell) => convertInlineLatex(cell).replace(/\n+/g, ' ').trim())
  );

  if (cells.length === 1) {
    return cells[0].join(' | ');
  }

  const header = cells[0];
  const separator = header.map(() => '---');
  const body = cells.slice(1);

  return [
    `| ${header.join(' | ')} |`,
    `| ${separator.join(' | ')} |`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

function convertBlockLatex(source) {
  let text = source;

  text = text.replace(/\\usetikzlibrary\{[^}]*\}/g, '');
  text = text.replace(/\\pgfplotsset\{[^}]*\}/g, '');
  text = text.replace(/\\sisetup\{[^}]*\}/g, '');
  text = text.replace(/\\label\{[^}]*\}/g, '');
  text = text.replace(/\\begin\{tabular\}\{(?:[^{}]|\{[^{}]*\})*\}/g, '\\begin{tabular}');

  text = replaceEnvironment(text, 'document', (content) => convertBlockLatex(content));
  text = replaceEnvironment(text, 'abstract', (content) => `\n## Abstract\n\n${convertBlockLatex(content)}\n`);
  text = replaceEnvironment(text, 'equation', (content) => `\n$$\n${content.replace(/\\label\{[^}]*\}/g, '').trim()}\n$$\n`);
  text = replaceEnvironment(text, 'equation*', (content) => `\n$$\n${content.replace(/\\label\{[^}]*\}/g, '').trim()}\n$$\n`);
  text = replaceEnvironment(text, 'align', (content) => `\n$$\n${content.replace(/\\label\{[^}]*\}/g, '').trim()}\n$$\n`);
  text = replaceEnvironment(text, 'align*', (content) => `\n$$\n${content.replace(/\\label\{[^}]*\}/g, '').trim()}\n$$\n`);
  text = replaceEnvironment(text, 'table', (content) => convertBlockLatex(content));
  text = replaceEnvironment(text, 'figure', (content) => {
    const caption = extractFirstCommandGroup(content, 'caption');
    const renderedCaption = caption ? convertInlineLatex(caption) : '';
    if (renderedCaption) {
      return `\n*Figure omitted in preview.* ${renderedCaption}\n`;
    }
    return '\n*Figure omitted in preview.*\n';
  });
  text = replaceEnvironment(text, 'center', (content) => convertBlockLatex(content));
  text = replaceEnvironment(text, 'itemize', (content) => `\n${convertItemize(content)}\n`);
  text = replaceEnvironment(text, 'enumerate', (content) => `\n${convertEnumerate(content)}\n`);
  text = replaceEnvironment(text, 'description', (content) => `\n${convertDescription(content)}\n`);
  text = replaceEnvironment(text, 'tabular', (content) => `\n${convertTabular(content)}\n`);

  text = replaceCommandWithGroup(text, 'section', (value) => `\n## ${convertInlineLatex(value)}\n`);
  text = replaceCommandWithGroup(text, 'subsection', (value) => `\n### ${convertInlineLatex(value)}\n`);
  text = replaceCommandWithGroup(text, 'subsubsection', (value) => `\n#### ${convertInlineLatex(value)}\n`);
  text = replaceCommandWithGroup(text, 'paragraph', (value) => `\n**${convertInlineLatex(value)}**\n`);
  text = replaceCommandWithGroup(text, 'caption', (value) => `\n*${convertInlineLatex(value)}*\n`);

  text = convertInlineLatex(text);

  return text
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function buildTitleBlock(title, author, date) {
  const titleLines = stripWrappedMarkdownEmphasis(convertInlineLatex(title || ''))
    .split(/\n+/)
    .map((line) => line.trim())
    .map((line) => line.replace(/^\*\*(.*)\*\*$/u, '$1').trim())
    .filter(Boolean);

  const authorLines = convertInlineLatex(author || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const dateLine = convertInlineLatex(date || '').trim();
  const parts = [];

  if (titleLines.length > 0) {
    parts.push(`# ${titleLines[0]}`);
    if (titleLines.length > 1) {
      parts.push(...titleLines.slice(1));
    }
  }

  if (authorLines.length > 0) {
    parts.push(authorLines.join('  \n'));
  }

  if (dateLine) {
    parts.push(dateLine);
  }

  return parts.filter(Boolean).join('\n\n');
}

function normalizeMathDelimiters(text) {
  return text
    .replace(/\\\[((?:.|\n|\r)*?)\\\]/g, (_, expression) => `\n$$\n${expression.trim()}\n$$\n`)
    .replace(/\\\(((?:\\.|[^\\)])+?)\\\)/g, (_, expression) => `$${expression.trim()}$`);
}

function normalizeMathContent(text) {
  return text
    .replace(/\\\[((?:.|\n|\r)*?)\\\]/g, (_, expression) => `\\[${normalizePairedMathPipes(expression)}\\]`)
    .replace(/\\\(((?:\\.|[^\\)])+?)\\\)/g, (_, expression) => `\\(${normalizePairedMathPipes(expression)}\\)`)
    .replace(/\$\$([\s\S]+?)\$\$/g, (_, expression) => `$$${normalizePairedMathPipes(expression)}$$`)
    .replace(/\$([^$\n]+?)\$/g, (_, expression) => `$${normalizePairedMathPipes(expression)}$`);
}

export default function latexToMarkdown(source) {
  if (!source) return '';

  const preprocessed = replaceScientificUnits(stripLatexComments(source));
  const protectedMath = protectMathSegments(preprocessed);
  const title = extractFirstCommandGroup(protectedMath.text, 'title');
  const author = extractFirstCommandGroup(protectedMath.text, 'author');
  const date = extractFirstCommandGroup(protectedMath.text, 'date');
  const titleBlock = buildTitleBlock(title, author, date);

  let text = protectedMath.text;
  text = text.replace(/\\documentclass(?:\[[^\]]*])?\{[^}]*\}/g, '');
  text = text.replace(/\\usepackage(?:\[[^\]]*])?\{[^}]*\}/g, '');
  text = text.replace(/\\geometry(?:\[[^\]]*])?\{[^}]*\}/g, '');
  text = text.replace(/\\definecolor(?:\[[^\]]*])?\{[^}]*\}\{[^}]*\}\{[^}]*\}/g, '');
  text = removeCommandDefinition(text, 'title');
  text = removeCommandDefinition(text, 'author');
  text = removeCommandDefinition(text, 'date');
  text = text.replace(/\\maketitle/g, titleBlock ? `${titleBlock}\n\n` : '');
  text = convertBlockLatex(text);
  text = protectedMath.restore(text);
  text = normalizeMathContent(text);
  text = normalizeMathDelimiters(text);

  return text
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
