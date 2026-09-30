# Launching Pendu online

A checklist for putting the website and the downloads live. Steps 1–4 are enough for a first launch. The rest can come later.

## 1. Get the code onto the default branch

The workflows only publish the website from the repository's default branch. On GitHub, go to **Settings → General → Default branch**. If it isn't `main`, you can rename it to `main` there. Then merge the pull request that adds `site/` and `.github/workflows/`.

## 2. Turn on GitHub Pages

Go to **Settings → Pages → Build and deployment**, and set **Source** to **GitHub Actions**.

Then open the **Actions** tab, pick **Website**, and click **Run workflow**. (After this it runs by itself whenever `site/` or `web/` changes.) When it finishes, the site is live at:

- `https://jaisudhakar.github.io/pendu-reminder/`: the product page
- `https://jaisudhakar.github.io/pendu-reminder/app/`: the board in the browser

## 3. Publish the first release

Set the version in `pendu/__init__.py` (`__version__ = "0.1.0"`), commit, then tag it:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The **Release** workflow runs the tests, builds `Pendu-Windows.exe`, `Pendu-macOS.zip` and `Pendu-Linux.tar.gz`, and publishes them on the releases page. The website's download buttons always point to the newest release, so you don't need to change the site for new versions.

To try the builds before releasing, run **Release** by hand from the Actions tab. The files show up as downloads on that run's page.

## 4. Try the downloads yourself

On each system you can get to, download from the website, open Pendu, add a note, log out and back in, and check the board comes up. The first launch will show a security warning (see step 6). The website's FAQ already explains how to get past it.

## 5. Your own domain (optional)

1. Buy a domain, such as `pendu.app` or `getpendu.com`.
2. Add a file `site/CNAME` with just the domain in it, like `getpendu.com`.
3. Set up the DNS records at your registrar as described in GitHub's [custom domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site), then tick **Enforce HTTPS** under Settings → Pages.
4. In `site/index.html`, change the `og:url` and `og:image` addresses to the new domain. Update the links at the top of `README.md` too.

## 6. Remove the "unknown app" warnings (later)

The downloads aren't code-signed, so Windows SmartScreen and macOS Gatekeeper warn people the first time. Many first-time visitors stop at that warning, so this is worth doing once people start using Pendu.

- **Windows:** [SignPath Foundation](https://signpath.org/) signs open-source projects for free. It needs an open-source license (see step 7). A paid code-signing certificate works too.
- **macOS:** join the [Apple Developer Program](https://developer.apple.com/programs/) (paid, yearly), then sign and notarize `Pendu.app` in the release workflow.

## 7. Add a license

The repository has no license yet, which means others can't legally reuse the code. If you want Pendu to be open source, add a `LICENSE` file. GitHub can make one for you: **Add file → Create new file**, name it `LICENSE`, and choose a template such as MIT. Free code-signing programs like SignPath need one.

## 8. Tell people

- Record a 15–30 second clip of notes flying onto the board and the board popping up when the laptop opens. That shows the whole idea faster than any text. Put it at the top of the README and in every post.
- Good places to post: Product Hunt, Hacker News ("Show HN: Pendu – today's tasks as sticky notes that pop up when you open your laptop"), Reddit (r/productivity, r/SideProject, r/opensource), Indie Hackers, X and LinkedIn.
- Point feedback to the GitHub **Issues** page. The website footer already links there.

## 9. Website visits (optional)

To see how many people visit and download, add a privacy-friendly counter such as [GoatCounter](https://www.goatcounter.com/) (free for personal projects) or Plausible to `site/index.html`. The FAQ promises that the *app* has no tracking. That stays true, but if you add a counter to the website, say so in the site's footer. The number of downloads per release is also shown on GitHub.
