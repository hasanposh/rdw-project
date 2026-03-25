const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.static("public"));

const TOKEN = "EggsGIayguvQTGXcwrfs2vO3P";

// RDW API Endpoints for different data segments
const RDW_APIS = {
  energiebron: "https://opendata.rdw.nl/resource/gr7t-qfnb.json",   // Fuel, Range, CO2
  basis: "https://opendata.rdw.nl/resource/byxc-wwua.json",         // Body type, Series, Weights
  aandrijving: "https://opendata.rdw.nl/resource/4by9-ammk.json",   // Drive type, Engine specs
  merk: "https://opendata.rdw.nl/resource/kyri-nuah.json",          // Make (Merk)
  model: "https://opendata.rdw.nl/resource/x5v3-sewk.json"          // Model (Handelsbenaming)
};

// Helper function to filter out blank, null, or undefined values
const removeBlanks = (obj) => {
  if (!obj) return {};
  return Object.fromEntries(
    Object.entries(obj).filter(([_, v]) => v !== null && v !== undefined && v !== "")
  );
};

// 1. Search by approval number to get available variants & uitvoerings
app.get("/api/search", async (req, res) => {
  const number = req.query.number;

  try {
    const response = await axios.get(RDW_APIS.basis, {
      headers: { "X-App-Token": TOKEN },
      params: {
        typegoedkeuringsnummer: number,
        $select: "codevarianttgk, codeuitvoeringtgk",
        $limit: 100
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch variants from RDW API" });
  }
});

// 2. Get the full, printer-friendly datasheet without any blanks
// 2. Get the full, printer-friendly datasheet without any blanks
// 2. Get the full, printer-friendly datasheet without any blanks
// 2. Get the full, printer-friendly datasheet without any blanks
// 2. Get the full, printer-friendly datasheet without any blanks
app.get("/api/details", async (req, res) => {
  const { number, variant, uitvoering } = req.query;

  if (!number || !variant || !uitvoering) {
    return res.status(400).json({ error: "Missing number, variant, or uitvoering parameters." });
  }

  try {
    const headers = { "X-App-Token": TOKEN };

    // Standard params for most endpoints
    const paramsFull = {
      typegoedkeuringsnummer: number,
      codevarianttgk: variant,
      codeuitvoeringtgk: uitvoering
    };

    // Fix for RDW's typo in their Model (Handelsbenaming) dataset
    const paramsModel = {
      typegoedkeuringsnummer: number,
      codevariantgk: variant, // Notice the missing 't' here!
      codeuitvoeringtgk: uitvoering
    };

    const RDW_APIS = {
      energiebron: "https://opendata.rdw.nl/resource/gr7t-qfnb.json",
      basis: "https://opendata.rdw.nl/resource/byxc-wwua.json",
      aandrijving: "https://opendata.rdw.nl/resource/4by9-ammk.json",
      merk: "https://opendata.rdw.nl/resource/kyri-nuah.json",
      model: "https://opendata.rdw.nl/resource/x5v3-sewk.json",
      carrosserie: "https://opendata.rdw.nl/resource/ky2r-jqad.json"
    };

    // Fetch the 6 core Type Approval datasets
    const [energiebronRes, basisRes, aandrijvingRes, merkRes, modelRes, carrosserieRes] = await Promise.all([
      axios.get(RDW_APIS.energiebron, { headers, params: paramsFull }).catch(() => ({ data: [] })),
      axios.get(RDW_APIS.basis, { headers, params: paramsFull }).catch(() => ({ data: [] })),
      axios.get(RDW_APIS.aandrijving, { headers, params: paramsFull }).catch(() => ({ data: [] })),
      axios.get(RDW_APIS.merk, { headers, params: paramsFull }).catch(() => ({ data: [] })),
      axios.get(RDW_APIS.model, { headers, params: paramsModel }).catch(() => ({ data: [] })),
      axios.get(RDW_APIS.carrosserie, { headers, params: paramsFull }).catch(() => ({ data: [] }))
    ]);

    let rawData = {
      ...(basisRes.data[0] || {}),
      ...(aandrijvingRes.data[0] || {}),
      ...(merkRes.data[0] || {}),
      ...(modelRes.data[0] || {}),
      ...(carrosserieRes.data[0] || {}),
      ...(energiebronRes.data[0] || {})
    };

    // --- THE GENIUS WORKAROUND FOR MAKE AND MODEL ---
    // Since Type Approval datasets only give us weird codes, we query the main 
    // Registered Vehicles dataset for ONE actual car with this approval number.
    // --- THE GENIUS WORKAROUND FOR MAKE, MODEL, AND BODY TYPE ---
    try {
      const carRes = await axios.get("https://opendata.rdw.nl/resource/m9d7-ebf2.json", {
        headers,
        params: {
          typegoedkeuringsnummer: number,
          $limit: 1,
          $select: "merk, handelsbenaming, inrichting" // <-- Added 'inrichting' (Body Type)
        }
      });
      
      if (carRes.data && carRes.data.length > 0) {
        if (carRes.data[0].merk) {
            rawData.merk_naam = carRes.data[0].merk; 
        }
        if (!rawData.handelsbenamingfabrikant && carRes.data[0].handelsbenaming) {
            rawData.handelsbenamingfabrikant = carRes.data[0].handelsbenaming;
        }
        // Grab the readable Body Type string (e.g. "stationwagen")
        if (carRes.data[0].inrichting) {
            rawData.carrosserie_naam = carRes.data[0].inrichting;
        }
      }
    } catch (err) {
      console.log("Could not find a registered car to extract the brand name.");
    }

    const cleanData = removeBlanks(rawData);

    if (Object.keys(cleanData).length === 0) {
      return res.status(404).json({ error: "No details found for this vehicle." });
    }

    res.json(cleanData);
  } catch (error) {
    console.error("Backend Details Error:", error.message);
    res.status(500).json({ error: "Failed to fetch comprehensive vehicle details" });
  }
});

// 3. Fetch the official RDW Glossary (Begrippenlijst) to automatically label data
app.get("/api/glossary", async (req, res) => {
  try {
    // Dataset gska-f75a contains the official column definitions for Type Approvals
    const response = await axios.get("https://opendata.rdw.nl/resource/gska-f75a.json", {
      headers: { "X-App-Token": TOKEN },
      params: { $limit: 2000 } // Fetch up to 2000 definitions
    });

    const dictionary = {};
    
    // Loop through RDW's glossary and build a simple Key -> Official Label map
    response.data.forEach(row => {
      // The dataset usually maps 'kolomnaam' to a 'begrip' or 'omschrijving'
      const apiKey = row.kolomnaam || row.attribuutnaam || row.elementnaam;
      const officialDefinition = row.begrip || row.omschrijving || row.definitie;
      
      if (apiKey && officialDefinition) {
        dictionary[apiKey.toLowerCase()] = officialDefinition;
      }
    });

    res.json(dictionary);
  } catch (error) {
    console.error("Failed to fetch RDW glossary:", error.message);
    res.status(500).json({ error: "Failed to fetch glossary" });
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});