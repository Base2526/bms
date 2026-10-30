"use client";
import { createContext, useContext } from "react";
export const RetailLocalMode = createContext(false);
export const useRetailLocalMode = () => useContext(RetailLocalMode);
