const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI("AIzaSyATkFkZsTJCumwrLLuL0GEJpiY302nodzQ");

async function test() {
  try {
    // Try gemini-pro which is very stable
    console.log("Testing gemini-2.5-flash-lite...");
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    const result = await model.generateContent("Hola, eres el asistente de Contex360?");
    console.log("Success with gemini-1.5-flash:", result.response.text());
  } catch (e) {
    console.log("Error Status:", e.status);
    console.log("Error Message:", e.message);
  }
}

test();
