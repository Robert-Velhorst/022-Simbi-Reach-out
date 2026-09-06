#!/usr/bin/env python3
"""
Simbi Automation Consolidated Script
====================================

This script combines all functionality from the separate Simbi automation files:
- Automated messaging system
- Advanced scraping and analysis
- Input device simulation
- Configuration management
- Data persistence and tracking

Features:
- Multi-mode operation (messaging, scraping, analysis)
- Machine learning-based similarity matching
- Comprehensive data collection
- Automated setup and configuration
- Input simulation capabilities
- CSV-based tracking system
"""

import os
import sys
import csv
import time
import json
import random
import logging
import argparse
from typing import List, Dict, Optional, Tuple
from datetime import datetime
from pathlib import Path

# Web automation imports
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from webdriver_manager.chrome import ChromeDriverManager

# Machine learning imports (optional)
try:
    from sentence_transformers import SentenceTransformer
    import numpy as np
    ML_AVAILABLE = True
except ImportError:
    ML_AVAILABLE = False
    print("Warning: Machine learning libraries not available. Similarity matching disabled.")

# Input simulation imports (optional)
try:
    from evdev import UInput, ecodes as e
    INPUT_SIM_AVAILABLE = True
except ImportError:
    INPUT_SIM_AVAILABLE = False
    print("Warning: evdev not available. Input simulation disabled.")


class SimbiConfig:
    """Configuration management for Simbi automation"""
    
    def __init__(self, config_file: str = "simbi_config.json"):
        self.config_file = config_file
        self.default_config = {
            "user_name": "Your Name",
            "service_url": "https://simbi.com/requests",
            "login_email": os.environ.get("SIMBI_LOGIN_EMAIL", ""),
            "login_password": os.environ.get("SIMBI_LOGIN_PASSWORD", ""),
            "max_pages": 150,
            "delay_min": 2,
            "delay_max": 5,
            "headless": False,
            "csv_file": "inbox.csv",
            "message_template": "Hi {user_name}, I saw your request for {request_title}. I'd be happy to help! Let me know if you're interested.",
            "similarity_threshold": 0.7,
            "enable_ml_matching": True,
            "enable_input_simulation": False
        }
        self.config = self.load_config()
    
    def load_config(self) -> Dict:
        """Load configuration from file or create default"""
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, 'r') as f:
                    config = json.load(f)
                # Merge with defaults to ensure all keys exist
                merged_config = self.default_config.copy()
                merged_config.update(config)
                return merged_config
            except Exception as e:
                print(f"Error loading config: {e}. Using defaults.")
                return self.default_config.copy()
        else:
            self.save_config(self.default_config)
            return self.default_config.copy()
    
    def save_config(self, config: Dict = None) -> None:
        """Save configuration to file"""
        if config is None:
            config = self.config
        try:
            with open(self.config_file, 'w') as f:
                json.dump(config, f, indent=2)
        except Exception as e:
            print(f"Error saving config: {e}")
    
    def update_config(self, **kwargs) -> None:
        """Update configuration values"""
        self.config.update(kwargs)
        self.save_config()


class SimbiDataManager:
    """Data management and CSV tracking"""
    
    def __init__(self, csv_file: str = "inbox.csv"):
        self.csv_file = csv_file
        self.sent_messages = set()
        self.load_sent_messages()
    
    def load_sent_messages(self) -> None:
        """Load previously sent messages from CSV"""
        if os.path.exists(self.csv_file):
            try:
                with open(self.csv_file, 'r', newline='', encoding='utf-8') as f:
                    reader = csv.DictReader(f)
                    for row in reader:
                        if 'link' in row:
                            self.sent_messages.add(row['link'])
            except Exception as e:
                print(f"Error loading sent messages: {e}")
    
    def is_message_sent(self, link: str) -> bool:
        """Check if message was already sent to this link"""
        return link in self.sent_messages
    
    def record_sent_message(self, data: Dict) -> None:
        """Record a sent message to CSV"""
        try:
            file_exists = os.path.exists(self.csv_file)
            with open(self.csv_file, 'a', newline='', encoding='utf-8') as f:
                fieldnames = ['timestamp', 'user_name', 'request_title', 'link', 'user_request_text', 'message_sent']
                writer = csv.DictWriter(f, fieldnames=fieldnames)
                
                if not file_exists:
                    writer.writeheader()
                
                data['timestamp'] = datetime.now().isoformat()
                writer.writerow(data)
                
                # Add to sent messages set
                if 'link' in data:
                    self.sent_messages.add(data['link'])
        except Exception as e:
            print(f"Error recording sent message: {e}")


class SimbiSimilarityMatcher:
    """Machine learning-based similarity matching"""
    
    def __init__(self, threshold: float = 0.7):
        self.threshold = threshold
        self.model = None
        if ML_AVAILABLE:
            try:
                self.model = SentenceTransformer('all-MiniLM-L6-v2')
                print("Similarity matching model loaded successfully")
            except Exception as e:
                print(f"Error loading similarity model: {e}")
                self.model = None
    
    def calculate_similarity(self, text1: str, text2: str) -> float:
        """Calculate similarity between two texts"""
        if not self.model or not ML_AVAILABLE:
            return 0.0
        
        try:
            embeddings = self.model.encode([text1, text2])
            similarity = np.dot(embeddings[0], embeddings[1]) / (
                np.linalg.norm(embeddings[0]) * np.linalg.norm(embeddings[1])
            )
            return float(similarity)
        except Exception as e:
            print(f"Error calculating similarity: {e}")
            return 0.0
    
    def find_matching_services(self, request_text: str, services: List[Dict]) -> List[Dict]:
        """Find services that match a request based on similarity"""
        if not self.model or not services:
            return []
        
        matches = []
        for service in services:
            service_text = service.get('description', '') + ' ' + service.get('title', '')
            similarity = self.calculate_similarity(request_text, service_text)
            
            if similarity >= self.threshold:
                service['similarity_score'] = similarity
                matches.append(service)
        
        # Sort by similarity score
        matches.sort(key=lambda x: x.get('similarity_score', 0), reverse=True)
        return matches


class SimbiInputSimulator:
    """Input device simulation for advanced automation"""
    
    def __init__(self):
        self.ui = None
        if INPUT_SIM_AVAILABLE:
            try:
                self.ui = UInput()
                print("Input simulation initialized successfully")
            except Exception as e:
                print(f"Error initializing input simulation: {e}")
                self.ui = None
    
    def simulate_key_press(self, key_code: int) -> None:
        """Simulate a key press"""
        if not self.ui or not INPUT_SIM_AVAILABLE:
            return
        
        try:
            self.ui.write(e.EV_KEY, key_code, 1)  # Key down
            self.ui.write(e.EV_KEY, key_code, 0)  # Key up
            self.ui.syn()
        except Exception as e:
            print(f"Error simulating key press: {e}")
    
    def simulate_text_input(self, text: str) -> None:
        """Simulate typing text"""
        if not self.ui or not INPUT_SIM_AVAILABLE:
            return
        
        # This is a simplified implementation
        # In practice, you'd need to map characters to key codes
        for char in text:
            if char == 'a':
                self.simulate_key_press(e.KEY_A)
            # Add more character mappings as needed
            time.sleep(0.1)
    
    def close(self) -> None:
        """Close the input device"""
        if self.ui:
            self.ui.close()


class SimbiAutomation:
    """Main Simbi automation class combining all functionality"""
    
    def __init__(self, config_file: str = "simbi_config.json"):
        self.config = SimbiConfig(config_file)
        self.data_manager = SimbiDataManager(self.config.config['csv_file'])
        self.similarity_matcher = SimbiSimilarityMatcher(self.config.config['similarity_threshold'])
        self.input_simulator = SimbiInputSimulator() if self.config.config['enable_input_simulation'] else None
        self.driver = None
        self.wait = None
        
        # Setup logging
        logging.basicConfig(
            level=logging.INFO,
            format='%(asctime)s - %(levelname)s - %(message)s',
            handlers=[
                logging.FileHandler('simbi_automation.log'),
                logging.StreamHandler()
            ]
        )
        self.logger = logging.getLogger(__name__)
    
    def setup_driver(self) -> None:
        """Setup Chrome WebDriver with appropriate options"""
        chrome_options = Options()
        
        if self.config.config['headless']:
            chrome_options.add_argument("--headless")
        
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")
        chrome_options.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        
        try:
            service = Service(ChromeDriverManager().install())
            self.driver = webdriver.Chrome(service=service, options=chrome_options)
            self.wait = WebDriverWait(self.driver, 10)
            self.logger.info("WebDriver setup completed successfully")
        except Exception as e:
            self.logger.error(f"Error setting up WebDriver: {e}")
            raise
    
    def login(self) -> bool:
        """Login to Simbi.com"""
        try:
            self.driver.get("https://simbi.com/login")
            time.sleep(2)
            
            # Enter email
            email_field = self.wait.until(EC.presence_of_element_located((By.NAME, "email")))
            email_field.send_keys(self.config.config['login_email'])
            
            # Enter password
            password_field = self.driver.find_element(By.NAME, "password")
            password_field.send_keys(self.config.config['login_password'])
            
            # Click login button
            login_button = self.driver.find_element(By.XPATH, "//button[@type='submit']")
            login_button.click()
            
            time.sleep(3)
            
            # Check if login was successful
            if "dashboard" in self.driver.current_url or "requests" in self.driver.current_url:
                self.logger.info("Login successful")
                return True
            else:
                self.logger.error("Login failed")
                return False
                
        except Exception as e:
            self.logger.error(f"Error during login: {e}")
            return False
    
    def scrape_requests(self, max_pages: int = None) -> List[Dict]:
        """Scrape requests from Simbi.com"""
        if max_pages is None:
            max_pages = self.config.config['max_pages']
        
        requests_data = []
        
        try:
            self.driver.get(self.config.config['service_url'])
            time.sleep(2)
            
            for page in range(1, max_pages + 1):
                self.logger.info(f"Scraping page {page}")
                
                # Wait for page to load
                time.sleep(random.uniform(
                    self.config.config['delay_min'],
                    self.config.config['delay_max']
                ))
                
                # Extract requests from current page
                page_requests = self.extract_requests_from_page()
                requests_data.extend(page_requests)
                
                # Navigate to next page
                if not self.go_to_next_page():
                    self.logger.info("No more pages available")
                    break
            
            self.logger.info(f"Scraped {len(requests_data)} requests from {page} pages")
            return requests_data
            
        except Exception as e:
            self.logger.error(f"Error scraping requests: {e}")
            return requests_data
    
    def extract_requests_from_page(self) -> List[Dict]:
        """Extract request data from current page"""
        requests = []
        
        try:
            # Wait for requests to load
            request_elements = self.wait.until(
                EC.presence_of_all_elements_located((By.CSS_SELECTOR, ".request-item, .card, .listing"))
            )
            
            for element in request_elements:
                try:
                    # Extract request data
                    request_data = {}
                    
                    # Try different selectors for title
                    title_selectors = [".title", ".request-title", "h3", "h4", ".card-title"]
                    for selector in title_selectors:
                        try:
                            title_element = element.find_element(By.CSS_SELECTOR, selector)
                            request_data['request_title'] = title_element.text.strip()
                            break
                        except NoSuchElementException:
                            continue
                    
                    # Try different selectors for user name
                    user_selectors = [".user-name", ".author", ".username", ".by"]
                    for selector in user_selectors:
                        try:
                            user_element = element.find_element(By.CSS_SELECTOR, selector)
                            request_data['user_name'] = user_element.text.strip()
                            break
                        except NoSuchElementException:
                            continue
                    
                    # Try different selectors for description
                    desc_selectors = [".description", ".content", ".text", "p"]
                    for selector in desc_selectors:
                        try:
                            desc_element = element.find_element(By.CSS_SELECTOR, selector)
                            request_data['user_request_text'] = desc_element.text.strip()
                            break
                        except NoSuchElementException:
                            continue
                    
                    # Try to get link
                    link_selectors = ["a", ".link"]
                    for selector in link_selectors:
                        try:
                            link_element = element.find_element(By.CSS_SELECTOR, selector)
                            request_data['link'] = link_element.get_attribute('href')
                            break
                        except NoSuchElementException:
                            continue
                    
                    # Only add if we have essential data
                    if request_data.get('request_title') and request_data.get('link'):
                        requests.append(request_data)
                
                except Exception as e:
                    self.logger.debug(f"Error extracting request data: {e}")
                    continue
            
            return requests
            
        except Exception as e:
            self.logger.error(f"Error extracting requests from page: {e}")
            return []
    
    def go_to_next_page(self) -> bool:
        """Navigate to the next page"""
        try:
            # Try different selectors for next page button
            next_selectors = [
                "//a[contains(text(), 'Next')]",
                "//a[contains(@class, 'next')]",
                "//button[contains(text(), 'Next')]",
                "//a[@rel='next']"
            ]
            
            for selector in next_selectors:
                try:
                    next_button = self.driver.find_element(By.XPATH, selector)
                    if next_button.is_enabled():
                        next_button.click()
                        return True
                except NoSuchElementException:
                    continue
            
            return False
            
        except Exception as e:
            self.logger.error(f"Error navigating to next page: {e}")
            return False
    
    def send_message(self, request_data: Dict) -> bool:
        """Send a message for a specific request"""
        try:
            # Check if message already sent
            if self.data_manager.is_message_sent(request_data.get('link', '')):
                self.logger.info(f"Message already sent to {request_data.get('link', '')}")
                return False
            
            # Navigate to request page
            if 'link' in request_data:
                self.driver.get(request_data['link'])
                time.sleep(2)
            
            # Find and click message/contact button
            message_selectors = [
                "//button[contains(text(), 'Message')]",
                "//a[contains(text(), 'Contact')]",
                "//button[contains(@class, 'message')]",
                "//a[contains(@class, 'contact')]"
            ]
            
            message_button = None
            for selector in message_selectors:
                try:
                    message_button = self.driver.find_element(By.XPATH, selector)
                    break
                except NoSuchElementException:
                    continue
            
            if not message_button:
                self.logger.warning("No message button found")
                return False
            
            message_button.click()
            time.sleep(2)
            
            # Find message text area
            text_area_selectors = [
                "textarea[name='message']",
                "textarea[placeholder*='message']",
                ".message-text",
                "textarea"
            ]
            
            text_area = None
            for selector in text_area_selectors:
                try:
                    text_area = self.driver.find_element(By.CSS_SELECTOR, selector)
                    break
                except NoSuchElementException:
                    continue
            
            if not text_area:
                self.logger.warning("No message text area found")
                return False
            
            # Compose message
            message_text = self.config.config['message_template'].format(
                user_name=request_data.get('user_name', 'there'),
                request_title=request_data.get('request_title', 'your request')
            )
            
            text_area.send_keys(message_text)
            time.sleep(1)
            
            # Find and click send button
            send_selectors = [
                "//button[contains(text(), 'Send')]",
                "//input[@type='submit']",
                "//button[@type='submit']"
            ]
            
            send_button = None
            for selector in send_selectors:
                try:
                    send_button = self.driver.find_element(By.XPATH, selector)
                    break
                except NoSuchElementException:
                    continue
            
            if send_button:
                send_button.click()
                time.sleep(2)
                
                # Record sent message
                request_data['message_sent'] = message_text
                self.data_manager.record_sent_message(request_data)
                
                self.logger.info(f"Message sent successfully to {request_data.get('user_name', 'user')}")
                return True
            else:
                self.logger.warning("No send button found")
                return False
                
        except Exception as e:
            self.logger.error(f"Error sending message: {e}")
            return False
    
    def run_messaging_mode(self) -> None:
        """Run the automated messaging system"""
        self.logger.info("Starting messaging mode")
        
        if not self.login():
            self.logger.error("Login failed. Cannot proceed with messaging.")
            return
        
        requests_data = self.scrape_requests()
        
        if not requests_data:
            self.logger.warning("No requests found to process")
            return
        
        sent_count = 0
        for request_data in requests_data:
            if self.send_message(request_data):
                sent_count += 1
            
            # Add delay between messages
            time.sleep(random.uniform(
                self.config.config['delay_min'],
                self.config.config['delay_max']
            ))
        
        self.logger.info(f"Messaging completed. Sent {sent_count} messages.")
    
    def run_analysis_mode(self) -> None:
        """Run analysis mode with similarity matching"""
        self.logger.info("Starting analysis mode")
        
        if not ML_AVAILABLE:
            self.logger.error("Machine learning libraries not available for analysis mode")
            return
        
        if not self.login():
            self.logger.error("Login failed. Cannot proceed with analysis.")
            return
        
        # Scrape requests
        requests_data = self.scrape_requests()
        
        # For demonstration, we'll analyze the requests
        # In a real scenario, you'd also scrape services and match them
        
        self.logger.info(f"Analyzing {len(requests_data)} requests")
        
        # Group similar requests
        similar_groups = self.group_similar_requests(requests_data)
        
        # Save analysis results
        self.save_analysis_results(similar_groups)
        
        self.logger.info("Analysis completed")
    
    def group_similar_requests(self, requests: List[Dict]) -> List[List[Dict]]:
        """Group similar requests together"""
        if not self.similarity_matcher.model:
            return [[req] for req in requests]  # Each request in its own group
        
        groups = []
        processed = set()
        
        for i, request in enumerate(requests):
            if i in processed:
                continue
            
            group = [request]
            processed.add(i)
            
            request_text = request.get('user_request_text', '') + ' ' + request.get('request_title', '')
            
            for j, other_request in enumerate(requests[i+1:], i+1):
                if j in processed:
                    continue
                
                other_text = other_request.get('user_request_text', '') + ' ' + other_request.get('request_title', '')
                
                similarity = self.similarity_matcher.calculate_similarity(request_text, other_text)
                
                if similarity >= self.similarity_matcher.threshold:
                    group.append(other_request)
                    processed.add(j)
            
            groups.append(group)
        
        return groups
    
    def save_analysis_results(self, groups: List[List[Dict]]) -> None:
        """Save analysis results to file"""
        try:
            results = {
                'timestamp': datetime.now().isoformat(),
                'total_requests': sum(len(group) for group in groups),
                'groups_count': len(groups),
                'groups': []
            }
            
            for i, group in enumerate(groups):
                group_data = {
                    'group_id': i + 1,
                    'size': len(group),
                    'requests': group
                }
                results['groups'].append(group_data)
            
            with open('analysis_results.json', 'w') as f:
                json.dump(results, f, indent=2)
            
            self.logger.info(f"Analysis results saved. Found {len(groups)} groups.")
            
        except Exception as e:
            self.logger.error(f"Error saving analysis results: {e}")
    
    def cleanup(self) -> None:
        """Cleanup resources"""
        if self.driver:
            self.driver.quit()
        
        if self.input_simulator:
            self.input_simulator.close()
        
        self.logger.info("Cleanup completed")


def main():
    """Main function with command line interface"""
    parser = argparse.ArgumentParser(description="Simbi Automation Consolidated Script")
    parser.add_argument('--mode', choices=['messaging', 'analysis', 'scraping'], 
                       default='messaging', help='Operation mode')
    parser.add_argument('--config', default='simbi_config.json', 
                       help='Configuration file path')
    parser.add_argument('--headless', action='store_true', 
                       help='Run in headless mode')
    parser.add_argument('--max-pages', type=int, 
                       help='Maximum pages to scrape')
    parser.add_argument('--setup', action='store_true', 
                       help='Setup configuration interactively')
    
    args = parser.parse_args()
    
    if args.setup:
        setup_configuration(args.config)
        return
    
    # Create automation instance
    automation = SimbiAutomation(args.config)
    
    # Update config with command line arguments
    if args.headless:
        automation.config.update_config(headless=True)
    
    if args.max_pages:
        automation.config.update_config(max_pages=args.max_pages)
    
    try:
        # Setup driver
        automation.setup_driver()
        
        # Run based on mode
        if args.mode == 'messaging':
            automation.run_messaging_mode()
        elif args.mode == 'analysis':
            automation.run_analysis_mode()
        elif args.mode == 'scraping':
            requests_data = automation.scrape_requests()
            print(f"Scraped {len(requests_data)} requests")
            
            # Save scraped data
            with open('scraped_requests.json', 'w') as f:
                json.dump(requests_data, f, indent=2)
            print("Scraped data saved to scraped_requests.json")
    
    except KeyboardInterrupt:
        print("\nOperation interrupted by user")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        automation.cleanup()


def setup_configuration(config_file: str) -> None:
    """Interactive configuration setup"""
    print("Simbi Automation Configuration Setup")
    print("=====================================")
    
    config = SimbiConfig(config_file)
    
    # Get user inputs
    user_name = input(f"Your name [{config.config['user_name']}]: ").strip()
    if user_name:
        config.config['user_name'] = user_name
    
    login_email = input(f"Simbi login email [{config.config['login_email']}]: ").strip()
    if login_email:
        config.config['login_email'] = login_email
    
    login_password = input("Simbi login password: ").strip()
    if login_password:
        config.config['login_password'] = login_password
    
    max_pages = input(f"Maximum pages to scrape [{config.config['max_pages']}]: ").strip()
    if max_pages and max_pages.isdigit():
        config.config['max_pages'] = int(max_pages)
    
    headless = input(f"Run in headless mode? (y/n) [{'y' if config.config['headless'] else 'n'}]: ").strip().lower()
    if headless in ['y', 'yes']:
        config.config['headless'] = True
    elif headless in ['n', 'no']:
        config.config['headless'] = False
    
    # Save configuration
    config.save_config()
    print(f"\nConfiguration saved to {config_file}")


if __name__ == "__main__":
    main()

