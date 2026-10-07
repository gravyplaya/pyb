import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-[#f8f4e3]">
      {/* Header/Navigation */}
      <header className="bg-[#1a1a1a] text-white py-4">
        <div className="container mx-auto px-4 flex justify-between items-center">
          <div className="flex items-center">
            <h1 className="text-2xl font-bold">PUCKY O'BILLS</h1>
          </div>
          <nav className="hidden md:block">
            <ul className="flex space-x-6">
              <li><Link href="/" className="hover:text-[#f8d347]">HOME</Link></li>
              <li><Link href="/menu" className="hover:text-[#f8d347]">MENU</Link></li>
              <li><Link href="/about" className="hover:text-[#f8d347]">ABOUT</Link></li>
              <li><Link href="/contact" className="hover:text-[#f8d347]">CONTACT</Link></li>
            </ul>
          </nav>
          <div className="md:hidden">
            <button className="text-white">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="bg-[#1a1a1a] text-white py-20 text-center">
        <div className="container mx-auto px-4">
          <h2 className="text-5xl font-bold mb-6">AUTHENTIC IRISH PUB & RESTAURANT</h2>
          <p className="text-xl mb-8 max-w-2xl mx-auto">Serving traditional Irish fare and craft beers in a warm, welcoming atmosphere since 1995.</p>
          <div className="flex justify-center gap-4">
            <a href="/menu" className="bg-[#f8d347] text-[#1a1a1a] px-8 py-3 rounded-md font-bold hover:bg-[#e6c235] transition duration-300">VIEW MENU</a>
            <a href="/reservations" className="border-2 border-white px-8 py-3 rounded-md font-bold hover:bg-white hover:text-[#1a1a1a] transition duration-300">MAKE RESERVATION</a>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 bg-[#f8f4e3]">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white p-8 rounded-lg shadow-md text-center">
              <div className="bg-[#1a1a1a] text-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-2">AUTHENTIC CUISINE</h3>
              <p className="text-gray-600">Traditional Irish dishes made with locally sourced ingredients and family recipes.</p>
            </div>
            <div className="bg-white p-8 rounded-lg shadow-md text-center">
              <div className="bg-[#1a1a1a] text-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-2">CRAFT BEERS</h3>
              <p className="text-gray-600">Wide selection of Irish and local craft beers on tap, rotated seasonally.</p>
            </div>
            <div className="bg-white p-8 rounded-lg shadow-md text-center">
              <div className="bg-[#1a1a1a] text-white w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-2">LIVE MUSIC</h3>
              <p className="text-gray-600">Traditional Irish music sessions every weekend featuring local musicians.</p>
            </div>
          </div>
        </div>
      </section>

      {/* About Section */}
      <section className="py-16 bg-white">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row items-center gap-12">
            <div className="md:w-1/2">
              <div className="bg-[#1a1a1a] h-80 w-full rounded-lg flex items-center justify-center">
                <p className="text-white">Image Placeholder</p>
              </div>
            </div>
            <div className="md:w-1/2">
              <h2 className="text-3xl font-bold mb-4">OUR STORY</h2>
              <p className="text-gray-700 mb-6">Founded in 1995 by Patrick O'Bill, our pub has been serving the community with authentic Irish hospitality for over 25 years. What started as a small family business has grown into a beloved local institution.</p>
              <p className="text-gray-700 mb-6">We pride ourselves on maintaining the traditional Irish pub atmosphere while offering modern amenities and an extensive menu that caters to all tastes.</p>
              <a href="/about" className="bg-[#1a1a1a] text-white px-6 py-2 rounded-md font-bold hover:bg-[#333] transition duration-300">LEARN MORE</a>
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-16 bg-[#f8f4e3]">
        <div className="container mx-auto px-4 text-center">
          <h2 className="text-3xl font-bold mb-12">WHAT OUR CUSTOMERS SAY</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white p-8 rounded-lg shadow-md">
              <div className="text-[#f8d347] text-4xl mb-4">★★★★★</div>
              <p className="text-gray-700 mb-4">"The best Irish pub outside of Dublin! Amazing food and atmosphere."</p>
              <p className="font-bold">- Michael S.</p>
            </div>
            <div className="bg-white p-8 rounded-lg shadow-md">
              <div className="text-[#f8d347] text-4xl mb-4">★★★★★</div>
              <p className="text-gray-700 mb-4">"Their shepherd's pie is to die for! And the live music on weekends is fantastic."</p>
              <p className="font-bold">- Sarah L.</p>
            </div>
            <div className="bg-white p-8 rounded-lg shadow-md">
              <div className="text-[#f8d347] text-4xl mb-4">★★★★★</div>
              <p className="text-gray-700 mb-4">"Warm, welcoming staff and the best Guinness pour in town. A true Irish experience."</p>
              <p className="font-bold">- James O.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Call to Action */}
      <section className="py-16 bg-[#1a1a1a] text-white text-center">
        <div className="container mx-auto px-4">
          <h2 className="text-3xl font-bold mb-6">JOIN US FOR HAPPY HOUR</h2>
          <p className="text-xl mb-8 max-w-2xl mx-auto">Monday through Friday, 4-7pm. Enjoy discounted drinks and appetizers!</p>
          <a href="/contact" className="bg-[#f8d347] text-[#1a1a1a] px-8 py-3 rounded-md font-bold hover:bg-[#e6c235] transition duration-300">CONTACT US</a>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#1a1a1a] text-white py-12">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div>
              <h3 className="text-xl font-bold mb-4">PUCKY O'BILLS</h3>
              <p className="text-gray-400">Authentic Irish Pub & Restaurant</p>
            </div>
            <div>
              <h4 className="text-lg font-bold mb-4">HOURS</h4>
              <p className="text-gray-400 mb-2">Monday-Thursday: 11am-11pm</p>
              <p className="text-gray-400 mb-2">Friday-Saturday: 11am-1am</p>
              <p className="text-gray-400">Sunday: 12pm-10pm</p>
            </div>
            <div>
              <h4 className="text-lg font-bold mb-4">CONTACT</h4>
              <p className="text-gray-400 mb-2">123 Main Street</p>
              <p className="text-gray-400 mb-2">Anytown, USA 12345</p>
              <p className="text-gray-400 mb-2">Phone: (555) 123-4567</p>
              <p className="text-gray-400">Email: info@puckyobills.com</p>
            </div>
            <div>
              <h4 className="text-lg font-bold mb-4">FOLLOW US</h4>
              <div className="flex space-x-4">
                <a href="#" className="text-white hover:text-[#f8d347]">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M22.675 0h-21.35c-.732 0-1.325.593-1.325 1.325v21.351c0 .731.593 1.324 1.325 1.324h11.495v-9.294h-3.128v-3.622h3.128v-2.671c0-3.1 1.893-4.788 4.659-4.788 1.325 0 2.463.099 2.795.143v3.24l-1.918.001c-1.504 0-1.795.715-1.795 1.763v2.313h3.587l-.467 3.622h-3.12v9.293h6.116c.73 0 1.323-.593 1.323-1.325v-21.35c0-.732-.593-1.325-1.325-1.325z" />
                  </svg>
                </a>
                <a href="#" className="text-white hover:text-[#f8d347]">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
                  </svg>
                </a>
                <a href="#" className="text-white hover:text-[#f8d347]">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 4.557c-.883.392-1.832.656-2.828.775 1.017-.609 1.798-1.574 2.165-2.724-.951.564-2.005.974-3.127 1.195-.897-.957-2.178-1.555-3.594-1.555-3.179 0-5.515 2.966-4.797 6.045-4.091-.205-7.719-2.165-10.148-5.144-1.29 2.213-.669 5.108 1.523 6.574-.806-.026-1.566-.247-2.229-.616-.054 2.281 1.581 4.415 3.949 4.89-.693.188-1.452.232-2.224.084.626 1.956 2.444 3.379 4.6 3.419-2.07 1.623-4.678 2.348-7.29 2.04 2.179 1.397 4.768 2.212 7.548 2.212 9.142 0 14.307-7.721 13.995-14.646.962-.695 1.797-1.562 2.457-2.549z" />
                  </svg>
                </a>
              </div>
            </div>
          </div>
          <div className="border-t border-gray-800 mt-8 pt-8 text-center">
            <p className="text-gray-400">© 2023 Pucky O'Bills. All rights reserved.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
