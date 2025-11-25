const mongoose = require("mongoose");

const ParticipantSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  passwordHash: String,

  age: Number,
  cgpa: Number,
  aiUseHours: Number,
  sleepHours: Number,
  gender: String,

  initialScore: Number,
  normalizedScore: Number,
  category: String,

  group: String,
  assignedAt: Date,

  day1Score: Number,
  day1TakenAt: Date,

  day2Score: Number,
  day2TakenAt: Date,

  status: String, // signed_up, initial_done, assigned, day1_done, day2_done

  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Participant", ParticipantSchema);
