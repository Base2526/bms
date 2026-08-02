// apps/web/app/(admin)/admin/api/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
// import crypto from "crypto";
import * as jwt from "jsonwebtoken";

const ADMIN_COOKIE = "ADMIN_COOKIE";
// const hash = (s:string)=> crypto.createHash("sha256").update(s).digest("hex");

export async function POST(req: NextRequest){
  const { username, password } = await req.json();
  console.log("[LOGIN] username, password ", username, password);

  if(!username || !password)
    return NextResponse.json({error:"Missing"}, {status:400});

  const { rows } = await query(
    `SELECT id,name,email,role,password_hash FROM users
     WHERE LOWER(email)=LOWER($1) AND password_hash = crypt($2, password_hash)
     LIMIT 1`, [username, password]
  );

  const user = rows[0];
  if(!user /*|| user.password_hash !== hash(password) */ )
    return NextResponse.json({error:"Invalid"}, {status:401});
  if(user.role !== "Administrator")
    return NextResponse.json({error:"Not admin"}, {status:403});

  const token = jwt.sign(
    {
      id: user.id,
      sub: String(user.id),
      role: user.role,
      name: user.name,
      email: user.email,
    },
    process.env.JWT_SECRET || "changeme_secret",
    { algorithm:"HS256", expiresIn:"7d" }
  );

  console.log("[LOGIN SUCCESS]", user.name, user.role);

  const res = NextResponse.json({ ok:true });
  res.cookies.set(ADMIN_COOKIE, token, {
    httpOnly:true, sameSite:"lax", path:"/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60*60*24*7
  });
  return res;
}
