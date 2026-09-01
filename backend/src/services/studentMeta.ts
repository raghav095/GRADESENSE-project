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
export function extractStudentMeta(text: string): ExtractedStudentMeta {
  const nameMatch = text.match(/(?:student\s*)?name\s*[:\-]\s*([^\n\r]{1,60})/i);
  const rollMatch = text.match(/roll\s*(?:no\.?|number)?\s*[:\-]\s*([^\n\r]{1,20})/i);

  const studentName = nameMatch?.[1]?.trim();
  const rollNumber = rollMatch?.[1]?.trim();

  return {
    studentName: studentName || undefined,
    rollNumber: rollNumber || undefined,
  };
}
