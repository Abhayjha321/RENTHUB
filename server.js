
const express = require("express");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const path = require("path");
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || "renthub",
    waitForConnections: true,
    connectionLimit: 10
});

// Test server and MySQL
app.get("/api/health", async (req, res) => {
    try {
    await pool.query("SELECT 1");
    res.json({ success: true, message: "RentHub server and MySQL are connected" });
    } catch (error) {
    console.error("Database error:", error.message);
    res.status(500).json({ error: "MySQL connection failed. Check .env settings." });
    }
});

// Register a new user
app.post("/api/register", async (req, res) => {
    try {
    const { name, email, password, role, propertyId } = req.body;

    if (!name || !email || !password || !role || !propertyId) {
        return res.status(400).json({ error: "Please fill in all fields" });
    }

    if (password.length < 8) {
        return res.status(400).json({
        error: "Password must contain at least 8 characters"
        });
    }

    if (!["tenant", "owner"].includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
    }

    if (!["P1", "P2"].includes(propertyId)) {
        return res.status(400).json({ error: "Invalid property" });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const [existing] = await pool.execute(
        "SELECT id FROM users WHERE email = ?",
        [normalizedEmail]
    );

    if (existing.length) {
        return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    await pool.execute(
        `INSERT INTO users (name, email, password_hash, role, property_id)
        VALUES (?, ?, ?, ?, ?)`,
        [name.trim(), normalizedEmail, passwordHash, role, propertyId]
    );

    res.status(201).json({
        success: true,
        message: "Account created successfully. You can now sign in."
    });
    } catch (error) {
    console.error("Registration error:", error.message);
    res.status(500).json({ error: "Registration failed. Check the server terminal." });
    }
});

// Login with registered email and password
app.post("/api/login", async (req, res) => {
    try {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: "Enter your email and password" });
    }

    const [users] = await pool.execute(
        `SELECT id, name, email, password_hash, role, property_id
        FROM users WHERE email = ?`,
        [email.trim().toLowerCase()]
    );

    if (!users.length) {
        return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = users[0];
    const passwordMatches = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatches) {
        return res.status(401).json({ error: "Invalid email or password" });
    }

    await pool.execute(
        `INSERT INTO login_history (username, role, property_name)
        VALUES (?, ?, ?)`,
        [user.name, user.role, user.property_id]
    );

    res.json({
        success: true,
        user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        propertyId: user.property_id
        }
    });
    } catch (error) {
    console.error("Login error:", error.message);
    res.status(500).json({ error: "Login failed. Check the server terminal." });
    }
});

// Get maintenance requests
app.get("/api/maintenance", async (req, res) => {
    try {
    const [rows] = await pool.execute(
      "SELECT * FROM maintenance ORDER BY created_at DESC"
    );
    res.json(rows);
    } catch (error) {
    console.error("Maintenance error:", error.message);
    res.status(500).json({ error: "Could not load maintenance requests" });
    }
});

// Create a maintenance request
app.post("/api/maintenance", async (req, res) => {
    try {
    const { property_name, title, description, created_by } = req.body;

    if (!property_name || !title) {
        return res.status(400).json({
        error: "Property and request title are required"
        });
    }

    const [result] = await pool.execute(
        `INSERT INTO maintenance
        (property_name, title, description, created_by)
        VALUES (?, ?, ?, ?)`,
        [
        property_name,
        title,
        description || "",
        created_by || ""
        ]
    );

    res.status(201).json({
        success: true,
        id: result.insertId,
        message: "Maintenance request saved"
    });
    } catch (error) {
    console.error("Maintenance error:", error.message);
    res.status(500).json({ error: "Could not save maintenance request" });
    }
});

// Start the server
const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
    console.log(`RentHub running at http://localhost:${PORT}`);

    try {
    await pool.query("SELECT 1");
    console.log("MySQL connected successfully");
    } catch (error) {
    console.error("MySQL connection failed:", error.message);
    console.log("Check your .env file and make sure MySQL Server is running.");
    }
});
