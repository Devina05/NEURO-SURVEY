const mongoose = require("mongoose");

const MetaSchema = new mongoose.Schema({
  counts: {
    ai: { type: Number, default: 0 },
    nonai: { type: Number, default: 0 }
  },
  categories: {
    ai: { high: { type: Number, default: 0 }, med: { type: Number, default: 0 }, low: { type: Number, default: 0 } },
    nonai: { high: { type: Number, default: 0 }, med: { type: Number, default: 0 }, low: { type: Number, default: 0 } }
  },
  orderedParticipants: [String]
});

module.exports = mongoose.model("Meta", MetaSchema);
