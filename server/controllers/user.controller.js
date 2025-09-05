import User from '../models/user.js'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcrypt'
const saltRounds = 10

export const login = async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ message: "please fill all fields" });
  }
  
  const user = await User.findOne({ username: username });
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  
  try {
    const checkPassword = await bcrypt.compare(password, user.password);
    if (!checkPassword) {
      return res.status(403).json({ message: "password is not correct" });
    }
    
    const token = await jwt.sign(
      { id: user.id, username: user.username }, // Add username to token payload
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRATION }
    );
    
    return res.status(200).json({
      message: "user logged in successfully", 
      token: token,
      username: user.username // Return username in response
    });
  } catch (error) {
    return res.status(500).json({ message: `Internal server error ${error.message}` });
  }
};

export const signUp = async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ message: "please fill all the fields" });
  }
  
  const existingUser = await User.findOne({ username });
  if (existingUser) {
    return res.status(400).json({ message: "user already exists" });
  }
  
  try {
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    const token = await jwt.sign(
      { username: username }, // Include username in token
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRATION }
    );
    
    const newUser = new User({
      username,
      password: hashedPassword,
      token: token
    });
    
    await newUser.save();
    
    return res.status(201).json({ 
      message: "user created successfully", 
      token: token,
      username: username // Return username in response
    });
  } catch (error) {
    return res.status(500).json({ message: `internal server error ${error.message}` });
  }
};