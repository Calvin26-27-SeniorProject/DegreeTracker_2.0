#!/usr/bin/env python3
# /// script
# requires-python = ">=3.13"
# dependencies = [
#     "pyyaml",
# ]
# ///
"""
Simple Publication Sync Script

Generates missing publication pages from my_pubs.yml
"""

import datetime
import yaml
from pathlib import Path
import re

def load_publications(yaml_file: str | Path):
    """Load publications from YAML file"""
    with open(yaml_file, 'r') as f:
        return yaml.safe_load(f)

def get_existing_pub_dirs(pubs_dir="pubs"):
    """Get set of existing publication directory names"""
    pubs_path = Path(pubs_dir)
    if not pubs_path.exists():
        pubs_path.mkdir()
        return set()
    
    return {item.name for item in pubs_path.iterdir() if item.is_dir()}

def normalize_title(title, fallback=''):
    """Normalize title that might be a dict with 'value' key"""
    if isinstance(title, dict):
        return title.get('value', fallback)
    return title or fallback

def normalize_date(date):
    """Normalize date to string format"""
    if isinstance(date, int):
        return str(date)
    elif isinstance(date, datetime.date):
        return date.isoformat()
    return str(date) if date else ''

def normalize_parent(parent):
    """Extract parent title from parent field (list or dict)"""
    if not parent:
        return None
    
    if isinstance(parent, list):
        parent = parent[0] if parent else {}
    
    if isinstance(parent, dict) and 'title' in parent:
        return parent['title']
    
    return None

def generate_slug(pub_key, pub_data):
    """Generate URL-friendly slug from publication data"""
    title = normalize_title(pub_data.get('title'), pub_key)
    
    # Common words to remove for more meaningful slugs
    stop_words = {
        'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
        'by', 'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after',
        'above', 'below', 'between', 'among', 'the', 'is', 'are', 'was', 'were', 'be',
        'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
        'could', 'should', 'may', 'might', 'must', 'can', 'shall', 'we'
    }
    
    # Common abbreviations for technical terms
    abbreviations = {
        'natural': 'nat',
        'language': 'lang',
        'processing': 'proc',
        'machine': 'ml',
        'learning': 'learn',
        'artificial': 'ai',
        'intelligence': 'intel',
        'computer': 'comp',
        'science': 'sci',
        'human': 'human',
        'interaction': 'interact',
        'interface': 'ui',
        'user': 'user',
        'experience': 'exp',
        'system': 'sys',
        'model': 'model',
        'models': 'models',
        'predictive': 'pred',
        'collaborative': 'collab',
        'generation': 'gen',
        'automatic': 'auto',
        'evaluation': 'eval',
        'algorithm': 'algo',
        'approach': 'approach',
        'method': 'method',
        'analysis': 'analysis'
    }
    
    # Remove special characters and convert to lowercase
    slug = re.sub(r'[^\w\s-]', '', title)
    slug = slug.lower().strip()
    
    # Split into words
    words = slug.split()
    
    # Filter out stop words and apply abbreviations
    meaningful_words = []
    for word in words:
        if word not in stop_words:
            # Apply abbreviation if available, otherwise keep original
            abbreviated = abbreviations.get(word, word)
            meaningful_words.append(abbreviated)
    
    # Join words with hyphens
    slug = '-'.join(meaningful_words)
    
    # Get year for suffix
    date_str = normalize_date(pub_data.get('date', ''))
    year = date_str[:4] if date_str else ''
    
    # Smart truncation: respect word boundaries
    max_length = 45  # More generous length limit
    if year:
        # Reserve space for year suffix
        available_length = max_length - len(year) - 1  # -1 for the hyphen
    else:
        available_length = max_length
    
    if len(slug) > available_length:
        # Find the last complete word that fits
        words = slug.split('-')
        truncated_words = []
        current_length = 0
        
        for word in words:
            # Check if adding this word would exceed the limit
            word_length = len(word) + (1 if truncated_words else 0)  # +1 for hyphen
            if current_length + word_length <= available_length:
                truncated_words.append(word)
                current_length += word_length
            else:
                break
        
        slug = '-'.join(truncated_words) if truncated_words else words[0][:available_length]
    
    # Add year suffix
    if year:
        slug = f"{slug}-{year}"
    
    # Clean up any trailing hyphens
    slug = slug.strip('-')
    
    return slug

def extract_student_authors(authors):
    """Extract student authors (marked with *) and clean author list"""
    if isinstance(authors, str):
        authors = [authors]
    
    student_authors = []
    clean_authors = []
    
    for author in authors:
        if '*' in author:
            clean_name = author.replace('*', '').strip()
            formatted_name = format_author_name(clean_name)
            student_authors.append(formatted_name)
            clean_authors.append(formatted_name)
        else:
            formatted_name = format_author_name(author)
            clean_authors.append(formatted_name)
    
    return student_authors, clean_authors

def format_author_name(name):
    """Convert author name from 'Last, First' to 'First Last' format if needed"""
    name = name.strip()
    
    # Check if name is in "Last, First" format (contains a comma)
    if ',' in name:
        parts = name.split(',', 1)  # Split on first comma only
        if len(parts) == 2:
            last_name = parts[0].strip()
            first_name = parts[1].strip()
            return f"{first_name} {last_name}"
    
    # If no comma or invalid format, return as-is
    return name

def normalize_author_names(authors):
    """Normalize all author names to 'First Last' format"""
    if isinstance(authors, str):
        authors = [authors]
    
    return [format_author_name(author) for author in authors]

def generate_quarto_content(pub_key, pub_data):
    """Generate complete Quarto file content"""
    authors = pub_data.get('author', [])
    student_authors, clean_authors = extract_student_authors(authors)
    
    title = normalize_title(pub_data.get('title'), '')
    normalized_date = normalize_date(pub_data.get('date', ''))
    parent_title = normalize_parent(pub_data.get('parent'))
    
    # Build frontmatter
    frontmatter = {
        'title': title,
        'authors': clean_authors,
        'date': normalized_date,
        'categories': ["HCI", "NLP"]  # Default, customize as needed
    }
    
    # Add optional fields
    if parent_title:
        frontmatter['publication'] = parent_title
    
    if 'abstract' in pub_data:
        frontmatter['abstract'] = pub_data['abstract']
    
    if 'url' in pub_data:
        frontmatter['url_pdf'] = pub_data['url']
    
    # Generate YAML frontmatter using yaml library
    content = "---\n"
    content += yaml.dump(frontmatter, default_flow_style=False, allow_unicode=True)
    content += "---\n\n"
    
    # Add student author callout
    if student_authors:
        content += "::: {.callout-important}\n"
        if len(student_authors) == 1:
            content += f"Note: {student_authors[0]} is an undergraduate student\n"
        else:
            content += f"Note: {', '.join(student_authors)} are undergraduate students\n"
        content += ":::\n\n"
    
    # Add featured image
    content += "![](featured.png)\n\n"
    
    # Add publication link
    if 'url' in pub_data:
        venue = parent_title or 'Publication'
        content += f"[PDF]({pub_data['url']}) {venue}\n\n"
    
    # Add abstract
    content += "## Abstract\n\n"
    abstract = pub_data.get('abstract')
    if abstract:
        content += f"{abstract}\n"
    else:
        content += "*Abstract to be added*\n"
    
    return content

def create_publication_page(pub_key, pub_data, slug, pubs_dir="pubs"):
    """Create publication directory and files"""
    pub_dir = Path(pubs_dir) / slug
    pub_dir.mkdir(exist_ok=True)
    
    # Create index.qmd
    index_file = pub_dir / "index.qmd"
    content = generate_quarto_content(pub_key, pub_data)
    
    with open(index_file, 'w') as f:
        f.write(content)
        
    print(f"Created: {pub_dir}")
    return pub_dir

def sync_publications(yaml_file: str | Path = "my_pubs.yml"):
    """Main sync function"""
    print(f"Syncing publications from {yaml_file}...")

    pubs_data = load_publications(yaml_file)
    existing_dirs = get_existing_pub_dirs()
    
    print(f"Loaded {len(pubs_data)} publications")
    print(f"Found {len(existing_dirs)} existing directories")
    
    created_count = 0
    
    for pub_key, pub_data in pubs_data.items():
        slug = generate_slug(pub_key, pub_data)
        
        if slug not in existing_dirs:
            create_publication_page(pub_key, pub_data, slug)
            created_count += 1
    
    if created_count == 0:
        print("✅ All publications already have pages!")
    else:
        print(f"\n🎉 Created {created_count} new publication pages")
        print("\nNext steps:")
        print("1. Add featured.png images")
        print("2. Review and enhance generated content")
        print("3. Commit changes to git")

if __name__ == "__main__":
    default_yaml = "~/Dropbox/Ken/Docs/CV/my_pubs.yml"
    default_yaml = Path(default_yaml).expanduser()
    sync_publications(yaml_file=default_yaml)