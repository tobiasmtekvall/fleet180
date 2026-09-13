const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const RED = '0.529 0.078 0.078';
const INK = '0.095 0.095 0.095';

export function createChecklistPdf(checklist, periodLabel) {
  const pages = renderPages(checklist, periodLabel);
  return buildPdf(pages);
}

function renderPages(checklist, periodLabel) {
  const pages = [];
  let page = newPage();
  pages.push(page);
  drawFrame(page, 1);
  drawHeader(page, checklist, periodLabel);

  const columns = [49, 308];
  const columnWidth = 238;
  const sections = checklist.sections || [];
  const balanced = balanceSections(sections);
  const balancedHeights = balanced.map((columnSections) => columnSections.reduce((sum, section) => sum + estimateSectionHeight(section, columnWidth) + 9, 0));

  if (Math.max(...balancedHeights, 0) <= 535) {
    balanced.forEach((columnSections, columnIndex) => {
      let columnY = 633;
      for (const section of columnSections) {
        columnY = drawSection(page, section, columns[columnIndex], columnY, columnWidth) - 9;
      }
    });
  } else {
    let column = 0;
    let y = 633;
    for (const section of sections) {
      const blockHeight = estimateSectionHeight(section, columnWidth);
      if (y - blockHeight < 92) {
        if (column === 0) {
          column = 1;
          y = 633;
        } else {
          page = newPage();
          pages.push(page);
          drawFrame(page, pages.length);
          drawContinuationHeader(page, checklist, periodLabel);
          column = 0;
          y = 744;
        }
      }
      y = drawSection(page, section, columns[column], y, columnWidth) - 9;
    }
  }

  const comments = (checklist.sections || []).map((section) => ({
    title: section.title || 'Comments',
    text: checklist.comments?.[section.id] || ''
  }));

  if (comments.length) {
    page = newPage();
    pages.push(page);
    drawFrame(page, pages.length);
    drawContinuationHeader(page, checklist, periodLabel, 'COMMENTS');
    let commentY = 740;
    for (const comment of comments) {
      const lines = wrapText(comment.text || '', 475, 9);
      const height = Math.max(54, 29 + lines.length * 11);
      if (commentY - height < 65) {
        page = newPage();
        pages.push(page);
        drawFrame(page, pages.length);
        drawContinuationHeader(page, checklist, periodLabel, 'COMMENTS');
        commentY = 740;
      }
      text(page, 52, commentY, 9.5, comment.title.toUpperCase(), true, INK, 0.7);
      const boxTop = commentY - 9;
      const boxBottom = boxTop - height + 17;
      rect(page, 50, boxBottom, 495, height - 15, 0.8);
      let ty = boxTop - 15;
      for (const line of lines.slice(0, Math.floor((height - 28) / 11))) {
        text(page, 58, ty, 9, line, false, INK);
        ty -= 11;
      }
      commentY = boxBottom - 17;
    }
  }

  return pages.map((commands, index) => {
    commands.push(textCommand(526, 26, 7.5, String(index + 1), false, INK));
    return commands.join('\n');
  });
}

function newPage() { return []; }

function drawFrame(page) {
  rect(page, 28, 34, PAGE_WIDTH - 56, PAGE_HEIGHT - 68, 1.25);
  rect(page, 32, 38, PAGE_WIDTH - 64, PAGE_HEIGHT - 76, 0.35);
  text(page, 474, 819, 7.4, 'R E S T R I C T E D', false, INK);
  text(page, 31, 24, 7.4, 'R E S T R I C T E D', false, INK);
}

function drawHeader(page, checklist, periodLabel) {
  centeredText(page, 756, 14.2, (checklist.title || 'APPROVED SUBSTITUTE CHECKLIST').toUpperCase(), true, INK, 1.15);
  centeredText(page, 735, 8.2, `REVISED ${checklist.revision || new Date().toISOString().slice(0, 10)}`, true, INK, 0.5);
  centeredText(page, 706, 9.2, `CHECKLIST TYPE: ${checklist.mode || 'DO-CONFIRM'}`, false, INK, 0.25);
  centeredText(page, 687, 9.2, checklist.primaryRole || "SUBSTITUTE'S DUTIES IN RED", false, RED);
  centeredText(page, 671, 9.2, checklist.secondaryRole || 'SUPPORT DUTIES IN BLACK', false, INK);
  centeredText(page, 649, 7.8, periodLabel.toUpperCase(), false, INK, 0.45);
}

function drawContinuationHeader(page, checklist, periodLabel, suffix = 'CONTINUED') {
  centeredText(page, 782, 11.5, (checklist.title || 'APPROVED SUBSTITUTE CHECKLIST').toUpperCase(), true, INK, 0.8);
  centeredText(page, 763, 7.7, `${periodLabel.toUpperCase()} - ${suffix}`, false, INK, 0.35);
}


function balanceSections(sections) {
  const columns = [[], []];
  const heights = [0, 0];
  for (const section of sections) {
    const index = heights[0] <= heights[1] ? 0 : 1;
    columns[index].push(section);
    heights[index] += estimateSectionHeight(section, 238) + 9;
  }
  return columns;
}

function estimateSectionHeight(section, width) {
  let height = 20;
  for (const item of section.items || []) {
    const itemText = `${item.action || ''} - ${(item.state || '').toUpperCase()}`;
    height += Math.max(1, wrapText(itemText, width - 38, 8.7).length) * 10.4;
  }
  return height;
}

function drawSection(page, section, x, startY, width) {
  let y = startY;
  text(page, x, y, 9.9, (section.title || 'SECTION').toUpperCase(), true, INK, 0.8);
  y -= 15;
  let index = 1;
  for (const item of section.items || []) {
    const itemText = `${item.action || ''} - ${(item.state || '').toUpperCase()}`;
    const lines = wrapText(itemText, width - 37, 8.7);
    const color = item.role === 'primary' ? RED : INK;
    text(page, x, y, 8.5, `${index}.`, false, INK);
    let lineY = y;
    for (const wrapped of lines) {
      text(page, x + 17, lineY, 8.7, wrapped, false, color);
      lineY -= 10.4;
    }
    rect(page, x + width - 9, y - 1, 7.2, 7.2, 0.8);
    if (item.done) {
      line(page, x + width - 7.7, y + 1.5, x + width - 5.7, y - 0.5, 1.1, RED);
      line(page, x + width - 5.7, y - 0.5, x + width - 1.9, y + 4.3, 1.1, RED);
    }
    y = lineY;
    index += 1;
  }
  return y;
}

function centeredText(page, y, size, value, bold = false, color = INK, spacing = 0) {
  const approximate = stringWidth(value, size, spacing);
  text(page, Math.max(40, (PAGE_WIDTH - approximate) / 2), y, size, value, bold, color, spacing);
}

function text(page, x, y, size, value, bold = false, color = INK, spacing = 0) {
  page.push(textCommand(x, y, size, value, bold, color, spacing));
}

function textCommand(x, y, size, value, bold = false, color = INK, spacing = 0) {
  return `BT /${bold ? 'F2' : 'F1'} ${size.toFixed(2)} Tf ${color} rg ${spacing.toFixed(2)} Tc 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${pdfEscape(value)}) Tj ET`;
}

function rect(page, x, y, width, height, lineWidth = 0.7) {
  page.push(`${INK} RG ${lineWidth.toFixed(2)} w ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re S`);
}

function line(page, x1, y1, x2, y2, lineWidth = 0.8, color = INK) {
  page.push(`${color} RG ${lineWidth.toFixed(2)} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
}

function stringWidth(value, size, spacing = 0) {
  return Array.from(String(value)).reduce((total, character) => {
    const factor = /[MW@#%]/.test(character) ? 0.78 : /[ilI1.,' ]/.test(character) ? 0.3 : 0.53;
    return total + size * factor + spacing;
  }, 0);
}

function wrapText(value, maxWidth, size) {
  const textValue = String(value || '').trim();
  if (!textValue) return [''];
  const words = textValue.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const proposed = current ? `${current} ${word}` : word;
    if (stringWidth(proposed, size) <= maxWidth) {
      current = proposed;
    } else if (current) {
      lines.push(current);
      current = word;
    } else {
      lines.push(word);
      current = '';
    }
  }
  if (current) lines.push(current);
  return lines;
}

function pdfEscape(value) {
  const cp1252 = {
    '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135,
    'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142,
    '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151,
    '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159
  };
  let output = '';
  for (const char of String(value ?? '')) {
    const codePoint = char.codePointAt(0);
    let byte;
    if (char in cp1252) byte = cp1252[char];
    else if (codePoint >= 32 && codePoint <= 126) byte = codePoint;
    else if (codePoint >= 160 && codePoint <= 255) byte = codePoint;
    else byte = 63;

    if (byte === 40 || byte === 41 || byte === 92) output += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32 || byte > 126) output += `\\${byte.toString(8).padStart(3, '0')}`;
    else output += String.fromCharCode(byte);
  }
  return output;
}

function buildPdf(pageStreams) {
  const objects = [];
  const pageRefs = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  pageStreams.forEach((stream, index) => {
    const pageObject = 5 + index * 2;
    const contentObject = pageObject + 1;
    pageRefs.push(`${pageObject} 0 R`);
    objects[pageObject] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObject} 0 R >>`;
    objects[contentObject] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Count ${pageStreams.length} /Kids [${pageRefs.join(' ')}] >>`;

  let pdf = '%PDF-1.4\n%1234\n';
  const offsets = [0];
  const maxObject = objects.length - 1;
  for (let number = 1; number <= maxObject; number += 1) {
    offsets[number] = pdf.length;
    pdf += `${number} 0 obj\n${objects[number]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${maxObject + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let number = 1; number <= maxObject; number += 1) {
    pdf += `${String(offsets[number]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${maxObject + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
