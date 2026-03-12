run: npm run dev

auth workflow:
[User Signup Page]
       |
       |  POST /api/signup  (username, email, password)
       v
   [route.js]
       |  Validate fields, hash password
       |  Insert user into Postgres DB
       v
[Postgres Database: users table]
       |
       |  Success response
       v
[User redirected to Login page]
       |
       |  POST /api/auth/callback/credentials
       |  (via signIn('credentials'))
       v
   [auth.js: Credentials authorize()]
       |  Query DB for username
       |  Compare hashed password
       |  Return user object
       v
[NextAuth Session Created]
       |  Sets cookie: authjs.session-token
       v
[Client: browser]
       |
       |  Requests protected pages
       v
   [proxy.js Middleware]
       |  Reads authjs.session-token
       |  If logged-in → allow access
       |  If not logged-in → redirect to /login
       v
[Protected Page / Dashboard]