// FULL BACKEND CODE  
// (Same as the generated zip — fully working)

// ---- Imports ----
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");

const Participant = require("./models/Participant");
const Meta = require("./models/Meta");
const Analysis = require("./models/Analysis");
const ss = require("simple-statistics");

const app = express();

app.use(cors());
app.use(express.json());

// 👉 FIX: SERVE CLIENT FOLDER CORRECTLY
app.get("/", (req, res) => {
  res.redirect("/login.html");
});


app.use(express.static(path.join(__dirname, "..", "client")));



const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 4000;
// ---- Database Connection ----

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ MongoDB Connected Successfully");
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err.message);
    process.exit(1);
  }
}

connectDB();

// -------------- Helper Functions -----------------

function categoryFromScore(s) {
  if (s >= 4) return "high";
  if (s >= 2) return "med";
  return "low";
}

function normalizeScore(raw, age, cgpa, aiUse, sleep) {
  let mod =
    0.5 * (cgpa / 10) +
    0.3 * (1 - aiUse / 24) +
    0.15 * (sleep / 10) +
    0.05 * (1 - Math.abs(age - 20) / 80);

  let final = raw * (0.8 + mod * 0.7);
  return Math.min(5, Math.max(0, final));
}

async function ensureMeta() {
  let meta = await Meta.findOne();
  if (!meta) meta = await Meta.create({});
  return meta;
}

// -------------- Auth Middleware -------------------

function adminOnly(req, res, next) {
  Participant.findById(req.userId).then(user => {
    if (!user || user.role !== "admin") {
      return res.status(403).json({ error: "Access denied" });
    }
    next();
  });
}

function auth(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// -------------- Routes ----------------------------

// SIGNUP
app.post("/api/signup", async (req, res) => {
  try {
    const { name, email, password, age, cgpa, aiUseHours, sleepHours, gender } =
      req.body;

    const exists = await Participant.findOne({ email });
    if (exists) return res.status(400).json({ error: "Email already exists" });

    const hash = await bcrypt.hash(password, 10);

    const user = await Participant.create({
      name,
      email,
      passwordHash: hash,
      age,
      cgpa,
      aiUseHours,
      sleepHours,
      gender,
      status: "signed_up"
    });

    const token = jwt.sign({ id: user._id }, JWT_SECRET);
    res.json({ token, id: user._id });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// LOGIN
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await Participant.findOne({ email });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ id: user._id }, JWT_SECRET);
  res.json({ token, id: user._id });
});

// SUBMIT INITIAL SCORE + ASSIGN GROUP
app.post("/api/initialScore", auth, async (req, res) => {
  const { score } = req.body;
  const p = await Participant.findById(req.userId);
  const meta = await ensureMeta();

  p.initialScore = score;
  p.normalizedScore = normalizeScore(
    score,
    p.age,
    p.cgpa,
    p.aiUseHours,
    p.sleepHours
  );
  p.category = categoryFromScore(Math.round(p.normalizedScore));
  p.status = "initial_done";

  await p.save();

  // GROUP ASSIGNMENT (same algorithm you approved)
  let group;
  let total = meta.counts.ai + meta.counts.nonai;

  if (total === 0) group = Math.random() < 0.5 ? "ai" : "nonai";
  else if (total === 1) {
    let first = await Participant.findById(meta.orderedParticipants[0]);
    if (first && first.category === p.category)
      group = first.group === "ai" ? "nonai" : "ai";
    else group = Math.random() < 0.5 ? "ai" : "nonai";
  } 
  else {
  let aiC = meta.categories.ai[p.category];
  let nonC = meta.categories.nonai[p.category];

  // ✅ STEP 1: CATEGORY FIRST
  if (aiC < nonC) {
    group = "ai";
  } else if (nonC < aiC) {
    group = "nonai";
  } else {

    // ✅ STEP 2: TOTAL SECOND
    if (meta.counts.ai < meta.counts.nonai) {
      group = "ai";
    } else if (meta.counts.nonai < meta.counts.ai) {
      group = "nonai";
    } else {

      // ✅ STEP 3: RANDOM
      group = Math.random() < 0.5 ? "ai" : "nonai";
    }
  }
}

  // UPDATE META + PARTICIPANT
  p.group = group;
  p.assignedAt = new Date();
  p.status = "assigned";
  await p.save();

  meta.counts[group]++;
  meta.categories[group][p.category]++;
  meta.orderedParticipants.push(p._id.toString());
  await meta.save();

  res.json({
    group,
    category: p.category,
    rules:
      group === "ai"
        ? "AI GROUP: You may use AI on Day-1, but NOT on Day-2."
        : "NON-AI GROUP: You may NOT use AI on Day-1, and NOT on Day-2."
  });
});

// GET PROFILE
app.get("/api/me", auth, async (req, res) => {
  res.json(await Participant.findById(req.userId).select("-passwordHash"));
});

// DAY1 PASSAGE
const passage = `
PASSAGE – The Miredan Civilization and the Lightwell System
The Miredan people inhabited the subterranean valleys of the Korath Basin, a vast underground region located approximately 400 metres below the surface of the Velun continent. Unlike surface civilizations that relied on sunlight, the Miредans developed an ingenious system of energy harvesting known as the Lightwell Network.
Each Lightwell was a vertical shaft, precisely 12 metres in diameter, drilled through the rock ceiling above a Miredan settlement. At the top of each shaft, engineers installed a crystalline lens made from compressed Solvite mineral. This lens captured and concentrated even the faintest traces of surface light, bending it downward into the underground settlements below. A single Lightwell could illuminate an area of roughly 3 square kilometres, which the Miредans called a Lumin Zone.
The Miredan society was divided into three occupational castes based on their relationship with the Lightwells. The Drillers were responsible for constructing new shafts and maintaining existing ones. The Lensmakers specialized in harvesting and processing Solvite, which was only found in the northern caves of the Korath Basin. The Wardens managed the distribution of light across Lumin Zones, ensuring that agricultural areas received priority during growing seasons.
Agriculture in the Korath Basin relied entirely on a crop called Fenroot, a pale tuberous plant that required only four hours of concentrated light per day to grow. Fenroot provided 80 percent of the Miredan diet, while the remaining 20 percent came from cave fungi harvested from the deeper, lightless tunnels. Every Miredan settlement maintained a strict light schedule — agricultural fields received light from dawn to midday, and residential areas received it from midday to dusk.
The decline of the Miredan civilization began when Solvite deposits in the northern caves became exhausted around the year 1,400 of the Miredan calendar. Without new lenses, existing Lightwells began to deteriorate. Within three generations, 60 percent of all Lumin Zones had gone dark. Fenroot harvests collapsed, and the population declined sharply. The remaining Miредans attempted to migrate to the surface but were unprepared for open sunlight, having lived underground for over 800 years. Historians consider the Miredan collapse one of the most complete civilizational failures in recorded history, caused entirely by dependence on a single non-renewable resource.
`;

app.get("/api/day1/passage", auth, async (req, res) => {
  const wpm = 250;
  const wordCount = passage.split(/\s+/).length;
  const viewMs = Math.ceil((wordCount / wpm) * 60 * 1000);

  res.json({ passage, viewMs });
});

// DAY1 SUBMIT
app.post("/api/day1/submit", auth, async (req, res) => {
  const { score } = req.body;
  const p = await Participant.findById(req.userId);

  p.day1Score = score;
  p.day1TakenAt = new Date();
  p.status = "day1_done";
  await p.save();

res.json({ next: "day2" });
});

// CHECK DAY2 AVAILABILITY
app.get("/api/day2/available", auth, async (req, res) => {
  const p = await Participant.findById(req.userId);
  if (!p.day1TakenAt)
    return res.json({ available: false, reason: "complete day1 first" });

   const diff = Date.now() - p.day1TakenAt.getTime();
  const min = 60 * 1000;
  const max = 48 * 3600 * 1000;

  if (diff < min)
    return res.json({ available: false, reason: "too early", waitMs: min - diff });

  if (diff > max)
    return res.json({ available: false, reason: "expired window" });

  return res.json({ available: true });
});

// DAY2 SUBMIT
app.post("/api/day2/submit", auth, async (req, res) => {
  const { score } = req.body;
  const p = await Participant.findById(req.userId);

  p.day2Score = score;
  p.day2TakenAt = new Date();
  p.status = "day2_done";
  await p.save();

  res.json({ ok: true });
});

// ADMIN ANALYSIS
app.get("/api/admin/analysis", async (req, res) => {
  const key = req.headers['adminkey'];

  if (key !== "devina123") {
    return res.status(403).json({ error: "Access denied" });
  }
    const all = await Participant.find({ group: { $exists: true } }).sort({
    assignedAt: 1
  });

  const ai = all.filter((x) => x.group === "ai");
  const non = all.filter((x) => x.group === "nonai");

  const n = Math.min(ai.length, non.length);
  if (n === 0) return res.json({ error: "Not enough participants" });

  function avg(arr, f) {
    const v = arr.map((x) => x[f]).filter((x) => typeof x === "number");
    return v.reduce((a, b) => a + b, 0) / v.length;
  }

  const summary = {
    n,
    ai: {
      avgDay1: avg(ai.slice(0, n), "day1Score"),
      avgDay2: avg(ai.slice(0, n), "day2Score")
    },
    nonai: {
      avgDay1: avg(non.slice(0, n), "day1Score"),
      avgDay2: avg(non.slice(0, n), "day2Score")
    }
  };

  res.json({ summary, generatedAt: new Date() });
});
app.get('/api/admin/all', async (req, res) => {
  const key = req.headers['adminkey'];

  if (key !== "devina123") {
    return res.status(403).json({ error: "Access denied" });
  }
  try {
    const participants = await Participant.find().select(
      "name email group category initialScore day1Score day2Score"
    );
    res.json(participants);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

// ── Helper: two-sample t-test ──
function tTest(a, b) {
  if (a.length < 2 || b.length < 2) 
    return { t: null, p: null, meanA: null, meanB: null };
  
  const meanA = ss.mean(a);
  const meanB = ss.mean(b);
  const varA = ss.sampleVariance(a);
  const varB = ss.sampleVariance(b);
  const se = Math.sqrt(varA / a.length + varB / b.length);
  
  if (se === 0) 
    return { t: 0, p: 1, meanA: +meanA.toFixed(2), meanB: +meanB.toFixed(2) };
  
  const t = (meanA - meanB) / se;
  const p = 2 * (1 - ss.cumulativeStdNormalProbability(Math.abs(t)));
  
  return { 
    t: +t.toFixed(3), 
    p: +p.toFixed(4), 
    meanA: +meanA.toFixed(2), 
    meanB: +meanB.toFixed(2) 
  };
}

// ── Full Hypothesis Analysis Endpoint ──
app.get('/api/admin/analysis/full', async (req, res) => {
  const key = req.headers['adminkey'];
  if (key !== "devina123") 
    return res.status(403).json({ error: "Access denied" });

  // Fetch only participants who completed both days
  const all = await Participant.find({
    group: { $exists: true },
    day1Score: { $exists: true },
    day2Score: { $exists: true }
  });

  const ai = all.filter(x => x.group === "ai");
  const nonai = all.filter(x => x.group === "nonai");

  // H1: Compare retention DROP between groups
  // drop = day1 - day2 (positive = forgot more)
  const aiDrop = ai.map(x => x.day1Score - x.day2Score);
  const nonaiDrop = nonai.map(x => x.day1Score - x.day2Score);
  const h1 = tTest(aiDrop, nonaiDrop);

  // H2: Compare Day 1 scores — did AI group score higher?
  const h2 = tTest(
    ai.map(x => x.day1Score), 
    nonai.map(x => x.day1Score)
  );

  // H3: Compare Day 2 scores — did Non-AI group score higher?
  const h3 = tTest(
    nonai.map(x => x.day2Score), 
    ai.map(x => x.day2Score)
  );

  // H5: Correlation — does lower initialScore = bigger drop? (AI group only)
  const h5pairs = ai
    .filter(x => x.initialScore != null)
    .map(x => [x.initialScore, x.day1Score - x.day2Score]);

  let h5corr = null;
  if (h5pairs.length >= 3) {
    h5corr = +ss.sampleCorrelation(
      h5pairs.map(x => x[0]), 
      h5pairs.map(x => x[1])
    ).toFixed(3);
  }

  // H5 extra: average drop broken down by category (low/med/high)
  const dropByCategory = {};
  ["low", "med", "high"].forEach(cat => {
    const catGroup = all.filter(x => x.category === cat);
    const drops = catGroup.map(x => x.day1Score - x.day2Score);
    dropByCategory[cat] = {
      n: drops.length,
      avgDrop: drops.length ? +ss.mean(drops).toFixed(2) : null
    };
  });

  res.json({
    sampleSize: { ai: ai.length, nonai: nonai.length, total: all.length },
    H1: {
      ...h1,
      label: "AI group shows greater retention drop",
      interpretation: h1.p !== null 
        ? (h1.p < 0.05 ? "✅ Supported" : "❌ Not supported") 
        : "Insufficient data",
      note: "meanA = AI drop, meanB = NonAI drop"
    },
    H2: {
      ...h2,
      label: "AI group scores higher on Day 1",
      interpretation: h2.p !== null 
        ? (h2.p < 0.05 && h2.meanA > h2.meanB ? "✅ Supported" : "❌ Not supported") 
        : "Insufficient data",
      note: "meanA = AI Day1, meanB = NonAI Day1"
    },
    H3: {
      ...h3,
      label: "Non-AI group outperforms on Day 2",
      interpretation: h3.p !== null 
        ? (h3.p < 0.05 && h3.meanA > h3.meanB ? "✅ Supported" : "❌ Not supported") 
        : "Insufficient data",
      note: "meanA = NonAI Day2, meanB = AI Day2"
    },
    H5: {
      correlation: h5corr,
      label: "Lower baseline = more retention loss (AI group)",
      interpretation: h5corr !== null 
        ? (h5corr < -0.3 ? "✅ Supported" : "❌ Not supported") 
        : "Insufficient data",
      note: "Negative value = lower initial score → bigger drop"
    },
    H5_byCategory: dropByCategory,
    generatedAt: new Date()
  });
});

app.get('/api/admin/dropout', async (req, res) => {
  const key = req.headers['adminkey'];
  if (key !== "devina123") 
    return res.status(403).json({ error: "Access denied" });

  const all = await Participant.find();

  const summary = {
    total: all.length,
    signedUp: all.filter(p => p.status === 'signed_up').length,
    initialDone: all.filter(p => p.status === 'initial_done').length,
    assigned: all.filter(p => p.status === 'assigned').length,
    day1Done: all.filter(p => p.status === 'day1_done').length,
    day2Done: all.filter(p => p.status === 'day2_done').length,
  };

  // dropout at each stage
  summary.dropAfterSignup = summary.signedUp;
  summary.dropAfterInitial = summary.initialDone;
  summary.dropAfterAssign = summary.assigned;
  summary.dropAfterDay1 = summary.day1Done - summary.day2Done;
  summary.completionRate = summary.total > 0
    ? ((summary.day2Done / summary.total) * 100).toFixed(1)
    : 0;

  res.json(summary);
});
// START SERVER
app.listen(PORT, () => console.log("Server running on port", PORT));


