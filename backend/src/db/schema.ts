import Database from 'better-sqlite3';
import path from 'path';

// The official model-answer prose for each seeded question (from the
// company-provided marking-scheme PDF) — shared by both initial seeding and
// the backfill migration below, so a database seeded before this field
// existed still gets it applied on next startup rather than staying null.
const MODEL_ANSWERS: Record<string, string> = {
  'q1-science':
    "A simple electric circuit provides a closed path through which electric current can flow. The battery provides the potential difference that drives current through the circuit. The switch is used to open or close the circuit. When the switch is closed, there is a complete conducting path and current can flow through the bulb and resistor. When the switch is open, the path is broken and current does not flow.\n\nThe bulb, resistor, battery, switch and ammeter should be connected in series in the main circuit. The ammeter must be connected in series because it measures the current flowing through the circuit. A voltmeter, however, should be connected in parallel across the bulb, because it measures the potential difference between the two ends of the bulb.\n\nA properly labelled diagram would therefore show the battery connected to the switch, resistor, bulb and ammeter in a single closed loop, with the voltmeter connected across the bulb. The conventional current direction should be shown from the positive terminal of the battery through the external circuit towards the negative terminal.\n\nThe amount of current flowing through the circuit depends on both the potential difference and the resistance. According to Ohm's law, V = IR. If the voltage of the battery remains constant and the resistance is increased, the current flowing through the circuit decreases. Conversely, reducing the resistance allows more current to flow.",
  'q2-english':
    'Technology has significantly changed the way students learn because information that was once difficult to access is now available within seconds. Students can use educational websites, digital libraries, videos and interactive tools to understand concepts that they may not have understood in a classroom. Technology can therefore make learning more flexible and allow students to explore topics according to their own interests and pace. For example, a student struggling with a difficult scientific concept can watch several different explanations until they find one that they understand.\n\nHowever, having easy access to information can also create a problem. Students may become dependent on searching for an answer instead of trying to solve a problem themselves. If a student immediately looks up the solution to every difficult question, they may complete their work but fail to develop their own reasoning and problem-solving abilities. There is also a risk that students may accept inaccurate information simply because it appears online.\n\nIn my opinion, technology does not automatically make students better or worse learners. Its effect depends on how it is used. Technology is most useful when students use it to understand concepts, explore different ideas and check their own work rather than simply copying answers. Therefore, technology should be treated as a tool that supports thinking, not as a replacement for thinking.',
  'q3-economics':
    'The demand and supply data can be represented on a graph with quantity on the horizontal axis and price on the vertical axis. The demand curve should slope downward from left to right because consumers generally demand a greater quantity when the price is lower. The supply curve should slope upward from left to right because producers are generally willing to supply a greater quantity when the price is higher.\n\nThe two curves intersect at a price of ₹30 and a quantity of 60 units. This point represents the market equilibrium because at this price the quantity demanded is equal to the quantity supplied.\n\nIf the market price is below the equilibrium price, quantity demanded is greater than quantity supplied. This creates a shortage because consumers want to buy more than producers are willing to sell. The shortage creates upward pressure on price.\n\nIf the market price is above the equilibrium price, quantity supplied is greater than quantity demanded. This creates a surplus because producers have more goods available than consumers are willing to purchase. The surplus creates downward pressure on price.\n\nIf the cost of producing the product increases, production becomes less profitable at each existing price. Producers will therefore be willing to supply less at each price. The supply curve shifts to the left/upward, from the original supply curve to a new supply curve.\n\nThe new equilibrium would generally occur at a higher price and lower quantity, assuming demand remains unchanged.',
};

export function initializeDatabase(dbPath?: string): Database.Database {
  const file = dbPath || path.join(process.cwd(), 'gradesense.db');
  const db = new Database(file);

  // Enable WAL mode for better concurrency
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      max_marks REAL NOT NULL,
      model_answer_text TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rubric_points (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL,
      criterion TEXT NOT NULL,
      max_marks REAL NOT NULL,
      order_index INTEGER NOT NULL,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      roll_number TEXT NOT NULL,
      student_answer_text TEXT NOT NULL,
      student_answer_file_path TEXT,
      source_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (question_id) REFERENCES questions(id)
    );

    CREATE TABLE IF NOT EXISTS grading_results (
      id TEXT PRIMARY KEY,
      submission_id TEXT NOT NULL,
      total_marks REAL NOT NULL,
      max_marks REAL NOT NULL,
      confidence REAL NOT NULL,
      needs_human_review INTEGER NOT NULL,
      review_reason TEXT,
      reviewed_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS rubric_point_results (
      id TEXT PRIMARY KEY,
      grading_result_id TEXT NOT NULL,
      rubric_point_id TEXT NOT NULL,
      marks_awarded REAL NOT NULL,
      max_marks REAL NOT NULL,
      status TEXT NOT NULL,
      evidence_quote TEXT,
      evidence_matched INTEGER NOT NULL,
      evidence_start INTEGER,
      evidence_end INTEGER,
      feedback TEXT NOT NULL,
      FOREIGN KEY (grading_result_id) REFERENCES grading_results(id) ON DELETE CASCADE,
      FOREIGN KEY (rubric_point_id) REFERENCES rubric_points(id)
    );

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      grading_result_id TEXT NOT NULL,
      page INTEGER NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      width REAL NOT NULL,
      height REAL NOT NULL,
      type TEXT NOT NULL,
      linked_point_result_id TEXT,
      correction_text TEXT NOT NULL,
      created_by_user INTEGER NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (grading_result_id) REFERENCES grading_results(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS llm_logs (
      id TEXT PRIMARY KEY,
      grading_result_id TEXT NOT NULL,
      pass TEXT NOT NULL,
      raw_request TEXT NOT NULL,
      raw_response TEXT NOT NULL,
      model TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      error TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (grading_result_id) REFERENCES grading_results(id) ON DELETE CASCADE
    );
  `);

  migrateAddedColumns(db);
  seedDefaultQuestions(db);
  backfillModelAnswerText(db);
  return db;
}

// Lightweight forward-only migration for columns added after a database file
// already existed on disk. CREATE TABLE IF NOT EXISTS above only helps for a
// brand new file, so any existing gradesense.db needs these added explicitly.
function migrateAddedColumns(db: Database.Database) {
  const addColumnIfMissing = (table: string, column: string, ddl: string) => {
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    } catch {
      // Column already exists — fine.
    }
  };

  addColumnIfMissing('rubric_point_results', 'evidence_start', 'INTEGER');
  addColumnIfMissing('rubric_point_results', 'evidence_end', 'INTEGER');
  addColumnIfMissing('grading_results', 'reviewed_at', 'TEXT');
  addColumnIfMissing('questions', 'model_answer_text', 'TEXT');
}

// A database seeded before model_answer_text existed has that column as NULL
// for its existing rows (migrateAddedColumns only adds the column, and
// seedDefaultQuestions only inserts into an empty table) — this backfills the
// known seed questions specifically, without touching anything else.
function backfillModelAnswerText(db: Database.Database) {
  const update = db.prepare('UPDATE questions SET model_answer_text = ? WHERE id = ? AND (model_answer_text IS NULL OR model_answer_text = ?)');
  Object.entries(MODEL_ANSWERS).forEach(([id, text]) => update.run(text, id, ''));
}

function seedDefaultQuestions(db: Database.Database) {
  const count = db.prepare('SELECT COUNT(*) as count FROM questions').get() as { count: number };
  if (count.count > 0) return;

  const insertQuestion = db.prepare(`
    INSERT INTO questions (id, subject, title, text, max_marks, model_answer_text, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertRubric = db.prepare(`
    INSERT INTO rubric_points (id, question_id, criterion, max_marks, order_index)
    VALUES (?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();

  // Q1 Science
  insertQuestion.run(
    'q1-science',
    'Science',
    'Question 1 — Electric Circuit Principles',
    'Explain how a simple electric circuit works and illustrate your explanation with a properly labelled circuit diagram showing a battery, switch, bulb, resistor, ammeter and voltmeter. Your answer should explain how the components are connected, the path followed by electric current, and how changing the resistance affects the current flowing through the circuit.',
    5.0,
    MODEL_ANSWERS['q1-science'],
    now
  );

  const q1Rubrics = [
    { id: 'q1-rp1', criterion: 'Main circuit components (battery, switch, bulb, resistor) connected correctly in series', max: 1.0, order: 1 },
    { id: 'q1-rp2', criterion: 'Ammeter connected in series and voltmeter connected in parallel across the bulb (or component being measured)', max: 1.0, order: 2 },
    { id: 'q1-rp3', criterion: 'Explains closed path of current flow and functional roles of components', max: 1.0, order: 3 },
    { id: 'q1-rp4', criterion: 'Explains Ohm’s law relationship (increased resistance decreases current flowing when voltage is constant)', max: 1.0, order: 4 },
    { id: 'q1-rp5', criterion: 'Properly labelled diagram with all components shown and conventional current direction indicated', max: 1.0, order: 5 },
  ];
  q1Rubrics.forEach(r => insertRubric.run(r.id, 'q1-science', r.criterion, r.max, r.order));

  // Q2 English
  insertQuestion.run(
    'q2-english',
    'English',
    'Question 2 — Technology in Education Essay',
    '"Technology has made information easier to access, but easier access to information does not necessarily mean better learning." Discuss this statement in detail. Write a well-structured response explaining whether you believe technology makes students better learners or makes them dependent on easily available answers. Support your argument with relevant examples, consider an opposing viewpoint, and conclude with your own reasoned opinion.',
    5.0,
    MODEL_ANSWERS['q2-english'],
    now
  );

  const q2Rubrics = [
    { id: 'q2-rp1', criterion: 'States a clear, unambiguous position on the essay prompt', max: 1.0, order: 1 },
    { id: 'q2-rp2', criterion: 'Provides well-structured arguments supported by relevant concrete examples', max: 1.0, order: 2 },
    { id: 'q2-rp3', criterion: 'Meaningfully considers and addresses an opposing viewpoint', max: 1.0, order: 3 },
    { id: 'q2-rp4', criterion: 'Demonstrates depth of reasoning rather than simple reliance on templates or keywords', max: 1.0, order: 4 },
    { id: 'q2-rp5', criterion: 'Concludes with a coherent, logical synthesis of the presented arguments', max: 1.0, order: 5 },
  ];
  q2Rubrics.forEach(r => insertRubric.run(r.id, 'q2-english', r.criterion, r.max, r.order));

  // Q3 Economics
  insertQuestion.run(
    'q3-economics',
    'Economics',
    'Question 3 — Supply and Demand Market Dynamics',
    'The table below shows the relationship between the price of a product and the quantity demanded and supplied in a market.\nPrice (₹): 10, 20, 30, 40, 50\nQuantity Demanded: 100, 80, 60, 40, 20\nQuantity Supplied: 20, 40, 60, 80, 100\nUsing the information provided, draw a properly labelled demand-and-supply graph and explain what the graph tells us about the market, including what happens when the market moves away from equilibrium and how an increase in the cost of production would affect the supply curve and the resulting market equilibrium.',
    5.0,
    MODEL_ANSWERS['q3-economics'],
    now
  );

  const q3Rubrics = [
    { id: 'q3-rp1', criterion: 'Accurately plots and labels demand (downward) and supply (upward) curves with Price on Y-axis and Quantity on X-axis', max: 1.0, order: 1 },
    { id: 'q3-rp2', criterion: 'Identifies equilibrium price (₹30) and equilibrium quantity (60 units) where Qd = Qs', max: 1.0, order: 2 },
    { id: 'q3-rp3', criterion: 'Explains disequilibrium dynamics: shortage when price is below equilibrium and surplus when price is above', max: 1.0, order: 3 },
    { id: 'q3-rp4', criterion: 'Correctly analyzes impact of increased production cost: supply curve shifts leftward / upward', max: 1.0, order: 4 },
    { id: 'q3-rp5', criterion: 'Correctly deduces new equilibrium outcome: higher equilibrium price and lower equilibrium quantity', max: 1.0, order: 5 },
  ];
  q3Rubrics.forEach(r => insertRubric.run(r.id, 'q3-economics', r.criterion, r.max, r.order));
}
