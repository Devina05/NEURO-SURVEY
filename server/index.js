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

const app = express();

app.use(cors());
app.use(express.json());

// 👉 FIX: SERVE CLIENT FOLDER CORRECTLY
app.use(express.static(path.join(__dirname, "..", "client")));



const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const PORT = process.env.PORT || 4000;

mongoose.connect(MONGODB_URI)
  .then(() => console.log("MongoDB Connected"))
  .catch((err) => console.log("MongoDB Error:", err));

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
    if (exists) return res.json({ error: "Email already exists" });

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
  if (!user) return res.json({ error: "Invalid credentials" });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.json({ error: "Invalid credentials" });

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
    if (first.category === p.category)
      group = first.group === "ai" ? "nonai" : "ai";
    else group = Math.random() < 0.5 ? "ai" : "nonai";
  } else {
    let ca = meta.counts.ai;
    let cn = meta.counts.nonai;

    if (ca < cn) group = "ai";
    else if (cn < ca) group = "nonai";
    else {
      let aiC = meta.categories.ai[p.category];
      let nonC = meta.categories.nonai[p.category];

      if (aiC < nonC) group = "ai";
      else if (nonC < aiC) group = "nonai";
      else group = Math.random() < 0.5 ? "ai" : "nonai";
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
PASSAGE – “The Cloud Forest Ecosystem”
Cloud forests are rare tropical forests found in high-altitude regions, usually between 1,500 and 3,000 meters above sea level. These forests remain enveloped in a constant layer of mist and low-lying clouds, which provide moisture directly to the leaves of plants. Unlike rainforests, which rely primarily on heavy rainfall, cloud forests depend on the subtle process of water condensing from the atmosphere.
Because of the cool, humid climate, cloud forests support an extraordinary range of plant life, including orchids, mosses, lichens, and tree ferns. Many of these plants are epiphytes—species that grow on the surface of other plants without taking nutrients from them. This unique vegetation structure helps create a dense, multi-layered canopy that traps water droplets and reduces evaporation.
Cloud forests play an essential role in regulating the water supply for nearby towns and agricultural regions. As clouds pass through the canopy, leaves capture moisture, which then drips down to the forest floor, replenishing streams and underground springs. This natural “water harvesting” system supports millions of people worldwide.
Sadly, cloud forests are among the most threatened ecosystems on Earth. Rising global temperatures are pushing cloud layers to higher altitudes, reducing the amount of moisture available to these forests. Deforestation for farming and development further shrinks their fragile habitat. Because many species found in cloud forests exist nowhere else, even small changes in temperature or humidity can lead to irreversible biodiversity loss.
Scientists warn that if protective measures are not taken soon, large sections of cloud forests may disappear within the next century, disrupting water cycles and eliminating countless plant and animal species. However, conservation projects—such as restoring nearby habitats, limiting land clearing, and protecting high-elevation zones—offer hope for preserving these irreplaceable ecosystems.

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

  res.json({ ok: true });
});

// CHECK DAY2 AVAILABILITY
app.get("/api/day2/available", auth, async (req, res) => {
  const p = await Participant.findById(req.userId);
  if (!p.day1TakenAt)
    return res.json({ available: false, reason: "complete day1 first" });

   // const diff = Date.now() - p.day1TakenAt.getTime();
  // const min = 24 * 3600 * 1000;
  // const max = 48 * 3600 * 1000;

  // if (diff < min)
  //   return res.json({ available: false, reason: "too early", waitMs: min - diff });

  // if (diff > max)
  //   return res.json({ available: false, reason: "expired window" });

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
  try {
    const participants = await Participant.find().select(
      "name email group category initialScore day1Score day2Score"
    );
    res.json(participants);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});


// START SERVER
app.listen(PORT, () => console.log("Server running on port", PORT));
