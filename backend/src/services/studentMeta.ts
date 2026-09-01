export interface ExtractedStudentMeta {
  studentName?: string;
  rollNumber?: string;
}

// Many real answer sheets — including the kind of blank template this
// assignment is built around — have a "Name: ___" / "Roll No: ___" line for
// the student to fill in by hand, ahead of their actual answer. A teacher
// shouldn't have to retype what's already on the page, so this is used as a
// fallback fill only when the form field itself was left blank — an
// explicitly typed name always wins.
// A real answer-sheet template very often puts Name and Roll No on the SAME
// physical line ("Name: Ananya Rao   Roll No: 24B"), not separate ones — a
// capture bounded only by the line break swallowed the roll number straight
// into the name. Bounded instead by whichever comes first: the next label
// keyword, a run of 2+ spaces/tabs (the usual column gap on a form line), or
// the line break itself.
const FIELD_STOP = '(?=\\s{2,}|\\t|\\bname\\b|\\broll\\b|\\n|\\r|$)';

export function extractStudentMeta(text: string): ExtractedStudentMeta {
  const nameMatch = text.match(new RegExp(`(?:student\\s*)?name\\s*[:\\-]\\s*(.{1,60}?)${FIELD_STOP}`, 'i'));
  const rollMatch = text.match(new RegExp(`roll\\s*(?:no\\.?|number)?\\s*[:\\-]\\s*(.{1,20}?)${FIELD_STOP}`, 'i'));

  // Trim trailing underscores/dashes too — common on a fill-in-the-blank
  // line when the field is answered partway across a longer blank.
  const studentName = nameMatch?.[1]?.trim().replace(/[_\-\s]+$/, '');
  const rollNumber = rollMatch?.[1]?.trim().replace(/[_\-\s]+$/, '');

  return {
    studentName: studentName || undefined,
    rollNumber: rollNumber || undefined,
  };
}
