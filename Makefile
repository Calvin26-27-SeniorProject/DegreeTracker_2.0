.PHONY: all check

all:
	cp /Users/ka37/Dropbox/ken/Docs/CV/cv.pdf static/kcarnold_cv.pdf
	cp "/Users/ka37/Library/CloudStorage/Dropbox/ken/Oregon/Research Statement.pdf" static/kcarnold_research_statement.pdf
	cp "/Users/ka37/Library/CloudStorage/OneDrive-CalvinUniversity/Scholarship/2026 Wisdom in AI Conference/From Every Language.pptx" static/wisdom2026-talks/
	cp "/Users/ka37/Library/CloudStorage/OneDrive-CalvinUniversity/Scholarship/2026 Wisdom in AI Conference/Building Tech with AI.pptx" static/wisdom2026-talks/
	quarto publish gh-pages --no-prompt --no-browser

check:
	rg '(^draft: |TODO)'
