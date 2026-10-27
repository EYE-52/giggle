<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{{NAME}} — Game Night by Giggle</title><meta name="description" content="Answer together, vote for your favorite."><link rel="canonical" href="https://play.gigglemeet.com/games/{{ID}}/"><link rel="stylesheet" href="./home.css"></head>
<body><main><a href="/">All games</a><h1>{{NAME}}</h1><p>Write your answer, then choose your favorite. Play with 3–12 friends.</p>
<form method="GET" action="/"><input type="hidden" name="game" value="{{ID}}"><label>Your party name<input name="name" required maxlength="16" autocomplete="nickname"></label><button type="submit">Create room</button><button type="submit" name="wantsetup" value="1">Customize + Create</button></form>
</main></body></html>
