from selenium import webdriver
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.by import By
from time import sleep
import config
import os
import csv


inbox = []
with open('inbox.csv', 'r') as fil:
    file_reader = csv.reader(fil)
    for row in file_reader:
        inbox.append(row)


username = os.environ.get("SIMBI_LOGIN_EMAIL", "")
password = os.environ.get("SIMBI_LOGIN_PASSWORD", "")

options = webdriver.ChromeOptions()
options.add_experimental_option('excludeSwitches', ['enable-logging'])

driver = webdriver.Chrome(ChromeDriverManager().install(), options=options)
driver.get('https://simbi.com/')

login_url = driver.find_element(By.XPATH, '/html/body/nav[2]/div/div[3]/a[3]')
login_url.click()

txtUsername = driver.find_element(By.ID, 'user_email')
txtPassword = driver.find_element(By.ID, 'user_password')
btnLogin = driver.find_element(By.NAME, 'commit')

txtUsername.send_keys(username)
txtPassword.send_keys(password)
btnLogin.click()
sleep(3)

page_number = 1
while page_number < 150:
    driver.get(f'https://simbi.com/requests?page={page_number}')

    cards = driver.find_elements(By.CLASS_NAME, 'click-link')

    request_links = []

    # Find already sent masseges if any
    for c in cards:
        post_link = c.get_attribute('href') in (
            item for sublist in inbox for item in sublist)

        if post_link:
            print("Visited")
        else:
            request_links.append(c.get_attribute('href'))

    print(len(request_links), "links")
    if len(request_links) > 0:
        for link in request_links:
            driver.get(link)
            sleep(2)
            request_title = driver.find_element(
                By.XPATH, '//*[@id="main-wrapper"]/div[2]/div/div/div[1]/div[2]/div/div[2]/div[1]/h2[1]')
            # sleep(1)
            user_title = driver.find_element(
                By.XPATH, '//*[@id="main-wrapper"]/div[2]/div/div/div[2]/div[3]/div[2]/div[1]/a/h4')
            # sleep(1)
            user_request = driver.find_element(
                By.XPATH, '//*[@id="main-wrapper"]/div[2]/div/div/div[1]/div[2]/div/div[2]/div[4]/p')
            # sleep(1)
            data = [user_title.text, request_title.text,
                    link, user_request.text]

            if data in inbox:
                print("Messege already sent")
            else:
                btnConversation = driver.find_element(
                    By.ID, 'start-conversation-btn')
                btnConversation.click()

                msg = f"Hello {user_title.text},\n I came across you request {request_title.text}\n I think i can help by finding the right Simbi candidate for you to help you with your request. Would you be interested in that ?\n For more information, here is my Simbi service:\n {config.service_URL}\n Looking forward to hearing from you\n ~ {config.name}"
                sleep(2)

                inquiry_box = driver.find_element(By.NAME, 'inquiry_text')
                inquiry_box.send_keys(msg)
                sleep(1)
                btnCancel = driver.find_element(
                    By.CSS_SELECTOR, 'body > div.modal.fade.brand-modal.v-middle.inquiry-modal.in > div > div > div > div.flex.between > button.btn.btn-wide-xs.btn-default')
                btnCancel.click()

                with open('inbox.csv', 'a', encoding="utf-8") as fin:
                    writer = csv.writer(fin)
                    writer.writerow(data)

            driver.get(f'https://simbi.com/requests?page={page_number}')
            sleep(2)
    else:
        pass
    page_number += 1
