#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ALLOWED_DIRECTIONS = new Set(['TB', 'TD', 'BT', 'RL', 'LR']);

function parseArgs() {
  const sourceArg = process.argv[2] || 'PROJECT_REPORT_GUIDE.md';
  const outputArg = process.argv[3] || 'FLOWCHARTS_MERMAID.md';
  const directionArg = (process.argv[4] || 'LR').toUpperCase();

  const direction = ALLOWED_DIRECTIONS.has(directionArg) ? directionArg : 'LR';

  return {
    sourcePath: path.resolve(process.cwd(), sourceArg),
    outputPath: path.resolve(process.cwd(), outputArg),
    direction,
  };
}

function cleanTitle(raw, fallbackIndex) {
  const cleaned = raw
    .replace(/^\d+\.\s*/, '')
    .replace(/^[-*]\s*/, '')
    .replace(/^\*\*/, '')
    .replace(/\*\*:?:?\s*$/, '')
    .replace(/^"|"$/g, '')
    .trim();

  return cleaned || `Flow ${fallbackIndex}`;
}

function cleanFlowLine(raw) {
  return raw
    .replace(/^[-*]\s*/, '')
    .replace(/^"|"$/g, '')
    .replace(/`/g, '')
    .trim();
}

function splitNodes(flowText) {
  return flowText
    .split(/\s*(?:→|->)\s*/)
    .map((part) => part.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
}

function isLikelyFlowCandidate(line, title, heading, nodesCount) {
  const context = `${title} ${heading}`.toLowerCase();
  const lowerLine = line.toLowerCase();

  if (nodesCount < 3) {
    return false;
  }

  if (/\b\d+(?:\.\d+)?rem\b|\b\d+px\b/.test(lowerLine)) {
    return false;
  }

  if (lowerLine.includes('click "new"') || lowerLine.includes('example:')) {
    return /flow|process|diagram|architecture/.test(context);
  }

  if (/flow|process|diagram|architecture|implementation/.test(context)) {
    return true;
  }

  return /^(user|browser|dashboard|scheduler|landing page)/.test(lowerLine);
}

function extractFlows(markdown) {
  const lines = markdown.split(/\r?\n/);
  const flows = [];

  let pendingTitle = '';
  let inCodeFence = false;
  let currentHeading = '';

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (/^#{1,6}\s+/.test(trimmed)) {
      currentHeading = trimmed.replace(/^#{1,6}\s+/, '').trim();
      continue;
    }

    if (trimmed.startsWith('```')) {
      inCodeFence = !inCodeFence;
      continue;
    }

    const titleMatch = trimmed.match(/^\d+\.\s+\*\*(.+?)\*\*:?:?\s*$/) ||
      trimmed.match(/^[-*]\s+\*\*(.+?)\*\*:?:?\s*$/);
    if (titleMatch) {
      pendingTitle = titleMatch[1].trim();
      continue;
    }

    if (!trimmed.includes('→') && !trimmed.includes('->')) {
      continue;
    }

    const line = cleanFlowLine(trimmed);
    const title = cleanTitle(pendingTitle, flows.length + 1);
    const nodes = splitNodes(line);

    if (!isLikelyFlowCandidate(line, title, currentHeading, nodes.length)) {
      continue;
    }

    // Continuation lines often start with an arrow in wrapped code blocks.
    if (/^(?:→|->)/.test(line) && flows.length > 0) {
      flows[flows.length - 1].rawFlow += ` ${line}`;
      continue;
    }

    pendingTitle = '';

    flows.push({
      title,
      rawFlow: line,
      inCodeFence,
    });
  }

  return flows
    .map((flow, index) => {
      const nodes = splitNodes(flow.rawFlow);
      if (nodes.length < 2) {
        return null;
      }

      return {
        id: index + 1,
        title: flow.title || `Flow ${index + 1}`,
        nodes,
      };
    })
    .filter(Boolean);
}

function escapeMermaidLabel(label) {
  return label.replace(/"/g, '\\"');
}

function renderMermaid(flow, direction) {
  const nodeIds = new Map();
  const declarations = [];
  const edges = [];

  for (const label of flow.nodes) {
    if (!nodeIds.has(label)) {
      const id = `n${flow.id}_${nodeIds.size + 1}`;
      nodeIds.set(label, id);
      declarations.push(`${id}["${escapeMermaidLabel(label)}"]`);
    }
  }

  for (let i = 0; i < flow.nodes.length - 1; i += 1) {
    const from = nodeIds.get(flow.nodes[i]);
    const to = nodeIds.get(flow.nodes[i + 1]);
    edges.push(`${from} --> ${to}`);
  }

  return [
    `flowchart ${direction}`,
    ...declarations,
    ...edges,
  ].join('\n');
}

function renderOutput(flows, sourcePath, direction) {
  const sourceName = path.basename(sourcePath);
  const generatedAt = new Date().toISOString();

  const sections = flows.map((flow) => {
    const mermaid = renderMermaid(flow, direction);
    return [
      `## ${flow.id}. ${flow.title}`,
      '',
      '```mermaid',
      mermaid,
      '```',
    ].join('\n');
  });

  return [
    '# Generated Mermaid Flowcharts',
    '',
    `Source: ${sourceName}`,
    `Direction: ${direction}`,
    `Generated at: ${generatedAt}`,
    '',
    sections.join('\n\n'),
    '',
  ].join('\n');
}

function main() {
  const { sourcePath, outputPath, direction } = parseArgs();

  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source file not found: ${sourcePath}`);
  }

  const markdown = fs.readFileSync(sourcePath, 'utf8');
  const flows = extractFlows(markdown);

  if (flows.length === 0) {
    throw new Error('No arrow-based flows were found. Add lines using "A → B → C" format.');
  }

  const output = renderOutput(flows, sourcePath, direction);
  fs.writeFileSync(outputPath, output, 'utf8');

  console.log(`Generated ${flows.length} Mermaid flowchart(s).`);
  console.log(`Output: ${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error(`Flowchart generation failed: ${error.message}`);
  process.exit(1);
}
