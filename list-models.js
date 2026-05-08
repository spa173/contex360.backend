const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI("AIzaSyATkFkZsTJCumwrLLuL0GEJpiY302nodzQ");

async function listModels() {
  try {
    console.log("Listing available models...");
    // Use the v1 API for listing
    const response = await fetch("https://generativelanguage.googleapis.com/v1/models?key=AIzaSyATkFkZsTJCumwrLLuL0GEJpiY302nodzQ");
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.log("Error:", e.message);
  }
}

listModels();
