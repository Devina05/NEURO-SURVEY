const mongoose = require("mongoose");

const AnalysisSchema = new mongoose.Schema({
  generatedAt: Date,
  summary: Object
});

module.exports = mongoose.model("Analysis", AnalysisSchema);
