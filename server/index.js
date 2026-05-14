// FULL BACKEND CODE  

// ---- Imports ----
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");
const jStat = require("jstat").jStat;

const Participant = require("./models/Participant");
const Meta = require("./models/Meta");
const Analysis = require("./models/Analysis");
const ss = require("simple-statistics");

const app = express();
const nodemailer = require("nodemailer");
const crypto = require("crypto");

app.use(cors());
app.use(express.json());

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

async function recomputeMeta() {
  const participants = await Participant.find({ group: { $exists: true }, category: { $exists: true } });
  const counts = { ai: 0, nonai: 0 };
  const categories = {
    ai: { high: 0, med: 0, low: 0 },
    nonai: { high: 0, med: 0, low: 0 }
  };
  const orderedParticipants = [];
  participants.forEach(p => {
    if (p.group && p.category) {
      counts[p.group]++;
      categories[p.group][p.category]++;
      orderedParticipants.push(p._id.toString());
    }
  });
  await Meta.findOneAndUpdate({}, { counts, categories, orderedParticipants }, { upsert: true });
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
    const { name, email, password, age, cgpa, aiUseHours, sleepHours, gender } = req.body;

    const exists = await Participant.findOne({ email });
    if (exists) return res.status(400).json({ error: "Email already exists" });

    const hash = await bcrypt.hash(password, 10);

    const user = await Participant.create({
      name, email, passwordHash: hash,
      age, cgpa, aiUseHours, sleepHours, gender,
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

  p.initialScore = score;
  p.normalizedScore = normalizeScore(p.initialScore, p.age, p.cgpa, p.aiUseHours, p.sleepHours);
  p.category = categoryFromScore(p.initialScore);
  p.status = "initial_done";
  await p.save();

  // Recompute Meta fresh before assigning
  await recomputeMeta();
  const freshMeta = await ensureMeta();

  // GROUP ASSIGNMENT
  let group;
  let total = freshMeta.counts.ai + freshMeta.counts.nonai;

  if (total === 0) {
    group = Math.random() < 0.5 ? "ai" : "nonai";
  } else {
    let aiC = freshMeta.categories.ai[p.category];
    let nonC = freshMeta.categories.nonai[p.category];

    if (aiC < nonC) {
      group = "ai";
    } else if (nonC < aiC) {
      group = "nonai";
    } else {
      // Category count equal → assign randomly
      group = Math.random() < 0.5 ? "ai" : "nonai";
    }
  }

  // Save participant with group
  p.group = group;
  p.assignedAt = new Date();
  p.status = "assigned";
  await p.save();

  // Recompute Meta after assigning
  await recomputeMeta();

  res.json({
    group,
    category: p.category,
    rules:
      group === "ai"
        ? "AI GROUP: You are requested to use AI given in the survey on Day-1, but NOT on Day-2."
        : "NON-AI GROUP: You may NOT use AI on Day-1, and NOT on Day-2."
  });
});

// GET PROFILE
app.get("/api/me", auth, async (req, res) => {
  res.json(await Participant.findById(req.userId).select("-passwordHash"));
});

// DAY1 PASSAGE
const passage = `PASSAGE – The Miredan Civilization and the Lightwell System
The Miredan people inhabited the subterranean valleys of the Korath Basin, a vast underground region located approximately 400 metres below the surface of the Velun continent. Unlike surface civilizations that relied on sunlight, the Miредans developed an ingenious system of energy harvesting known as the Lightwell Network.
Each Lightwell was a vertical shaft, precisely 12 metres in diameter, drilled through the rock ceiling above a Miredan settlement. At the top of each shaft, engineers installed a crystalline lens made from compressed Solvite mineral. This lens captured and concentrated even the faintest traces of surface light, bending it downward into the underground settlements below. A single Lightwell could illuminate an area of roughly 3 square kilometres, which the Miредans called a Lumin Zone.
The Miredan society was divided into three occupational castes based on their relationship with the Lightwells. The Drillers were responsible for constructing new shafts and maintaining existing ones. The Lensmakers specialized in harvesting and processing Solvite, which was only found in the northern caves of the Korath Basin. The Wardens managed the distribution of light across Lumin Zones, ensuring that agricultural areas received priority during growing seasons.
Agriculture in the Korath Basin relied entirely on a crop called Fenroot, a pale tuberous plant that required only four hours of concentrated light per day to grow. Fenroot provided 80 percent of the Miredan diet, while the remaining 20 percent came from cave fungi harvested from the deeper, lightless tunnels. Every Miredan settlement maintained a strict light schedule — agricultural fields received light from dawn to midday, and residential areas received it from midday to dusk.
The collapse of the Lightwell Network began in Year 1,200 of the Miredan calendar, when geological surveys revealed that Solvite deposits in the northern caves were nearly exhausted. By Year 1,400, the last known Solvite vein had been fully mined. Without new lenses to replace aging ones, Lightwells began to fail one by one. Within three generations, 60 percent of all Lumin Zones had gone dark. Agricultural output collapsed, and the Miredan civilization entered a prolonged period of famine and territorial contraction. Historians of the Velun surface civilizations would later refer to this era as the Long Dimming.`;

app.get("/api/day1/passage", auth, async (req, res) => {
  const p = await Participant.findById(req.userId);
  if (!p) return res.status(404).json({ error: "User not found" });
  res.json({ passage });
});

// DAY1 SUBMIT
app.post("/api/day1/submit", auth, async (req, res) => {
  const { score, tabSwitches } = req.body;
  const p = await Participant.findById(req.userId);
  if (!p) return res.status(404).json({ error: "User not found" });

  p.day1Score = score;
  p.day1TakenAt = new Date();
  p.tabSwitches = tabSwitches;
  p.status = "day1_done";
  await p.save();

  res.json({ ok: true, score });
});

// DAY1 POST-TASK
app.post("/api/day1/posttask", auth, async (req, res) => {
  const { aiRelianceRating, aiHelpfulnessRating, aiUsageDescription } = req.body;
  const p = await Participant.findById(req.userId);
  p.aiRelianceRating = aiRelianceRating;
  p.aiHelpfulnessRating = aiHelpfulnessRating;
  p.aiUsageDescription = aiUsageDescription;
  await p.save();
  res.json({ ok: true });
});

// DAY2 AVAILABLE CHECK
app.get("/api/day2/available", auth, async (req, res) => {
  const p = await Participant.findById(req.userId);
  if (!p) return res.status(404).json({ error: "User not found" });

  if (!p.day1TakenAt) {
    return res.json({ available: false, reason: "Day 1 not completed" });
  }

  const elapsed = Date.now() - new Date(p.day1TakenAt).getTime();
  const waitMs = 24 * 60 * 60 * 1000; // 24 hours
  const remaining = waitMs - elapsed;

  if (remaining <= 0) {
    res.json({ available: true });
  } else {
    res.json({ available: false, waitMs: remaining });
  }
});

// DAY2 SUBMIT
app.post("/api/day2/submit", auth, async (req, res) => {
  const { score } = req.body;
  const p = await Participant.findById(req.userId);
  if (!p) return res.status(404).json({ error: "User not found" });

  if (!p.day1TakenAt) {
    return res.status(400).json({ error: "Day 1 not completed" });
  }

  const elapsed = Date.now() - new Date(p.day1TakenAt).getTime();
  const waitMs = 24 * 60 * 60 * 1000;

  if (elapsed < waitMs) {
    return res.status(400).json({ error: "Day 2 not available yet" });
  }

  p.day2Score = score;
  p.day2TakenAt = new Date();
  p.status = "day2_done";
  await p.save();

  res.json({ ok: true, score });
});

// ADMIN - GET ALL PARTICIPANTS
app.get("/api/admin/all", async (req, res) => {
  const key = req.headers["adminkey"];
  if (key !== "REMOTE@123") return res.status(403).json({ error: "Access denied" });

  const participants = await Participant.find().select("-passwordHash").sort({ createdAt: -1 });
  res.json(participants);
});

// ADMIN - DELETE PARTICIPANT
app.delete("/api/admin/participant/:id", async (req, res) => {
  const key = req.headers["adminkey"];
  if (key !== "REMOTE@123") return res.status(403).json({ error: "Access denied" });

  const p = await Participant.findById(req.params.id);
  if (!p) return res.status(404).json({ error: "Participant not found" });

  await Participant.findByIdAndDelete(req.params.id);
  await recomputeMeta();
  res.json({ ok: true });
});


// AI CHAT
app.post("/api/ai/chat", auth, async (req, res) => {
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: "No message provided" });
    console.log("GROQ KEY present:", !!process.env.GROQ_API_KEY);

  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const groqRes = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
          },
          body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
              {
                role: "system",
                content: `You are a helpful assistant for a memory study. Answer questions using only this passage:

The Korath Basin lay 400 metres below the surface of Velun, a world with no natural sunlight at ground level. The Miredan people who lived there had engineered a system of vertical shafts called Lightwells, each 12 metres in diameter, which channelled light from the surface down into the basin. At the base of each shaft sat a crystalline lens made from a mineral called Solvite, which diffused the light across a wide area. Each illuminated area was called a Lumin Zone. A caste of workers called Wardens managed the light distribution schedules. Agriculture in the Korath Basin relied entirely on a crop called Fenroot, a pale tuberous plant that required only four hours of concentrated light per day to grow. Fenroot provided 80 percent of the Miredan diet. Solvite was found exclusively in the northern caves of the Korath Basin. By Year 1,400 of the Miredan calendar, Solvite deposits had been completely exhausted. Within three generations, 60 percent of all Lumin Zones had gone dark.

Do not answer question 9 (attention check). If asked, tell them to read the question carefully.`
              },
              {
                role: "user",
                content: message
              }
            ]
          })
        }
      );

      const data = await groqRes.json();
      console.log("Groq status:", groqRes.status);          // 👈 line 361
console.log("Groq response:", JSON.stringify(data));
      const reply = data.choices?.[0]?.message?.content;

      if (reply) return res.json({ reply });

      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 1000 * attempt));

    } catch (err) {
      console.log("Fetch error:", err.message);  // 👈 add here
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }

  res.json({ reply: "AI is unavailable right now. Please try again in a moment." });
});

// -------------- T-Test Helper -----------------
function tTest(a, b) {
  if (!a.length || !b.length || a.length < 2 || b.length < 2) {
    return {
      t: null,
      p: null,
      meanA: a.length ? +ss.mean(a).toFixed(2) : null,
      meanB: b.length ? +ss.mean(b).toFixed(2) : null
    };
  }

  const meanA = ss.mean(a);
  const meanB = ss.mean(b);
  const varA = ss.sampleVariance(a);
  const varB = ss.sampleVariance(b);

  const se = Math.sqrt((varA / a.length) + (varB / b.length));

  if (se === 0) {
    return { t: 0, p: 1, meanA: +meanA.toFixed(2), meanB: +meanB.toFixed(2) };
  }

  const t = (meanA - meanB) / se;

  const numerator = Math.pow((varA / a.length) + (varB / b.length), 2);
  const denominator =
    (Math.pow(varA / a.length, 2) / (a.length - 1)) +
    (Math.pow(varB / b.length, 2) / (b.length - 1));

  const df = numerator / denominator;
  const p = 2 * (1 - jStat.studentt.cdf(Math.abs(t), df));

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
  if (key !== "REMOTE@123")
    return res.status(403).json({ error: "Access denied" });

  const all = await Participant.find({
    group: { $exists: true },
    day1Score: { $exists: true },
    day2Score: { $exists: true }
  });

  const ai = all.filter(x => x.group === "ai");
  const nonai = all.filter(x => x.group === "nonai");

  const aiDrop = ai.map(x => x.day1Score - x.day2Score);
  const nonaiDrop = nonai.map(x => x.day1Score - x.day2Score);
  const h1 = tTest(aiDrop, nonaiDrop);
  const h2 = tTest(ai.map(x => x.day1Score), nonai.map(x => x.day1Score));
  const h3 = tTest(nonai.map(x => x.day2Score), ai.map(x => x.day2Score));

  const h4pairs = ai
    .filter(x => x.initialScore != null)
    .map(x => [x.initialScore, x.day1Score - x.day2Score]);

  let h4corr = null;
  if (h4pairs.length >= 3) {
    h4corr = +ss.sampleCorrelation(
      h4pairs.map(x => x[0]),
      h4pairs.map(x => x[1])
    ).toFixed(3);
  }

  const dropByCategory = {};
  ["low", "med", "high"].forEach(cat => {
    const catGroup = ai.filter(x => x.category === cat);
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
    H4: {
      correlation: h4corr,
      label: "Lower baseline = more retention loss (AI group)",
      interpretation: h4corr !== null
        ? (h4corr < -0.3 ? "✅ Supported" : "❌ Not supported")
        : "Insufficient data",
      note: "Negative value = lower initial score → bigger drop"
    },
    H4_byCategory: dropByCategory,
    generatedAt: new Date()
  });
});

// ADMIN - DROPOUT TRACKING
app.get('/api/admin/dropout', async (req, res) => {
  const key = req.headers['adminkey'];
  if (key !== "REMOTE@123")
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

  summary.dropAfterSignup = summary.signedUp;
  summary.dropAfterInitial = summary.initialDone;
  summary.dropAfterAssign = summary.assigned;
  summary.dropAfterDay1 = summary.day1Done - summary.day2Done;
  summary.completionRate = summary.total > 0
    ? ((summary.day2Done / summary.total) * 100).toFixed(1)
    : 0;

  res.json(summary);
});

app.post("/api/forgot-password", async (req, res) => {
  const { email } = req.body;
  const user = await Participant.findOne({ email });
  if (!user) return res.json({ ok: true }); // don't reveal if email exists

  const token = crypto.randomBytes(32).toString("hex");
  user.resetToken = token;
  user.resetTokenExpiry = Date.now() + 3600000; // 1 hour
  await user.save();

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });

  const resetLink = `http://localhost:4000/reset-password.html?token=${token}`;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: user.email,
    subject: "Password Reset — Neuro Survey",
    html: `<p>Click the link below to reset your password. It expires in 1 hour.</p>
           <a href="${resetLink}">${resetLink}</a>`
  });

  res.json({ ok: true });
});

app.post("/api/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;

  const user = await Participant.findOne({
    resetToken: token,
    resetTokenExpiry: { $gt: Date.now() }
  });

  if (!user) return res.status(400).json({ error: "Invalid or expired token" });

  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.resetToken = undefined;
  user.resetTokenExpiry = undefined;
  await user.save();

  res.json({ ok: true });
});
// START SERVER
app.listen(PORT, () => console.log("Server running on port", PORT));