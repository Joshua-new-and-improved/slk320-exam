# SLK 320 Exam: study site

A personal exam-study site for SLK 320 (University of Pretoria): Critical Psychology Ch 5 and 22, and Community Psychology Ch 1, 7, 18 and 23. It is built from the same source files as the Stage 1 PDF study guide.

- `index.html` is the whole app. CSS, content and JavaScript are inline.
- `img/` holds the 74 figures and photographs (WebP, lazy-loaded).
- `manifest.json`, `icon*.png` and `icon.svg` let you add the site to your home screen.
- `sw.js` is the service worker that lets the site work offline.
- `.nojekyll` tells GitHub Pages to serve the files as they are.

## Publish it on GitHub Pages (first time)

1. On github.com, click **New repository**. Name it `slk320-exam`, choose **Public** (see the note below), and don't add a README. Click **Create repository**.
2. On the new repository page, click **uploading an existing file**. Drag in **everything inside this folder**, including the `img` folder and the hidden `.nojekyll` file.
   - On a Mac, press **Cmd + Shift + .** in Finder to show hidden files.
   - The files must sit at the top level of the repository, not inside a sub-folder.
3. Click **Commit changes**.
4. Go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, branch **main**, folder **/ (root)**, then **Save**.
5. Wait one to two minutes. The site will be at: **https://joshua-new-and-improved.github.io/slk320-exam/**
6. On your phone, open that address in the browser and choose **Add to Home Screen**. It opens like an app.

If you use git instead of the web upload:

```
cd slk320-exam-site
git init && git add . && git commit -m "SLK 320 exam site"
git branch -M main
git remote add origin https://github.com/joshua-new-and-improved/slk320-exam.git
git push -u origin main
```

## Update it later

1. Replace the changed files in the repository. Use **Add file → Upload files** and drag in the new `index.html`, plus any new images. Then commit.
2. Wait a minute, then open the site with a new version number on the end of the address to skip old cached copies:
   - `https://joshua-new-and-improved.github.io/slk320-exam/?v=2`
   - Next time use `?v=3`, and so on.
3. The service worker always checks the network for `index.html` first, so a normal reload also picks up updates once you're online.

**Your progress is not affected by updates.** Progress, quiz scores, flashcard schedule, notes, highlights, bookmarks, plans and mock papers are stored in your browser under one key (`slk320.v1`). Use **Settings → Export progress** before changing phone or clearing your browser, and **Import progress** afterwards.

## Before you publish: privacy and copyright

- The Critical Psychology content was prepared from **Jenna Minnaar's notes, which are marked "do not sell or distribute"**. A public GitHub Pages site can be found and read by anyone who has the link.
- The page carries a `noindex` tag, so search engines are asked not to list it. That is a request, not a lock.
- To keep the site private, you can:
  - use a **private** repository with GitHub Pages, which needs a paid GitHub plan; or
  - skip publishing and open `index.html` directly from your phone or laptop. Everything works locally except offline caching.
- Photographs are CC BY / CC BY-SA from Wikimedia Commons. Their credits are in **Gallery** and **Image credits**. Keep those pages if you share the site.

## Assumptions to check

- The exam date isn't confirmed. Set it in **Settings** and the countdown on the home page starts.
- The exam duration isn't confirmed either. The Exam room defaults (60 minutes per half, 120 for the full paper) are adjustable.
